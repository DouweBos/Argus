import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { capture as telemetryCapture } from "../telemetry/telemetry";
import {
  classifyRunFailure,
  envForAccount,
  listClaudeAccounts,
  recordAuthOutcome,
  type AuthOutcome,
} from "./accounts";
import { emitAccountsChanged } from "./claudeAuth";

const execFileAsync = promisify(execFile);

const PROBE_TIMEOUT_MS = 12_000;

/**
 * Gateway credentials, which outrank the account's own sign-in when the CLI
 * sees them. Argus can inherit them from the shell that launched it, and then
 * the ping would report on the gateway rather than the account it names.
 */
const GATEWAY_ENV = ["ANTHROPIC_BASE_URL", "ANTHROPIC_AUTH_TOKEN"];

function execClaudePing(id: string): Promise<{ stdout: string }> {
  const env = envForAccount(id);
  for (const key of GATEWAY_ENV) {
    Reflect.deleteProperty(env, key);
  }

  return execFileAsync(
    "claude",
    ["--print", "--model", "haiku", "--output-format", "json", "ping"],
    { env, maxBuffer: 4 * 1024 * 1024, timeout: PROBE_TIMEOUT_MS },
  );
}

/**
 * Ask one account's CLI to do the smallest possible thing. The output matters
 * as much as the exit code: a spent quota and a dead token both fail, and only
 * the text says which — otherwise every limit reads as "not authenticated".
 */
export async function probeAccountAuth(id: string): Promise<AuthOutcome> {
  try {
    const { stdout } = await execClaudePing(id);
    const found = classifyRunFailure(stdout);
    if (found !== "unknown") {
      return found;
    }

    // The CLI can exit 0 with the failure inside the JSON envelope, so an
    // errored reply proves nothing about the credentials either way.
    return stdout.includes('"is_error":true') ? "unknown" : "ok";
  } catch (err) {
    const e = err as { message?: string; stderr?: string; stdout?: string };

    return classifyRunFailure(
      [e.stdout, e.stderr, e.message].filter(Boolean).join("\n"),
    );
  }
}

// Each re-check is a real API call, and the list is fetched on every
// accounts-changed event, so a flagged account is re-probed at most this often.
const RECHECK_INTERVAL_MS = 5 * 60_000;
const lastRecheck = new Map<string, number>();

/**
 * Re-probe every account carrying a limit or re-auth badge in the background.
 * Nothing else re-checks an account that isn't selected, so a quota that has
 * since reset would otherwise stay badged until an agent happened to run on it.
 */
export function recheckFlaggedAccounts(now = Date.now()): void {
  const due = listClaudeAccounts().filter(
    (a) =>
      (a.rate_limited || a.needs_reauth) &&
      now - (lastRecheck.get(a.id) ?? 0) >= RECHECK_INTERVAL_MS,
  );
  for (const account of due) {
    lastRecheck.set(account.id, now);
    probeAccountAuth(account.id).then((outcome) => {
      const changed = recordAuthOutcome(account.id, outcome);
      telemetryCapture("claude_account_rechecked", {
        badge_cleared: changed && outcome === "ok",
        outcome,
      });
      if (changed) {
        emitAccountsChanged();
      }
    });
  }
}

/** Test-only: forget when each account was last re-checked. */
export function resetRecheckThrottle(): void {
  lastRecheck.clear();
}
