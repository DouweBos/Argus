/**
 * Onboarding prerequisite checks.
 *
 * Runs checks in parallel and streams results back to the renderer via
 * `onboarding:prereq_update` events (emitted by the IPC layer).
 *
 * Each check is intentionally compact — the heavier `resolveBinary`/
 * dependency probing lives in `services/dependencies/check.ts`.
 */

import type { ClaudeAuthReason, PrereqId, PrereqResult } from "./types";
import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import {
  classifyRunFailure,
  envForAccount,
  getActiveAccountId,
  listClaudeAccounts,
  recordAuthOutcome,
  type AuthOutcome,
  type ClaudeAccount,
} from "../claudeAuth/accounts";
import { emitAccountsChanged } from "../claudeAuth/claudeAuth";
import { resolveBinary } from "../dependencies/check";

const execFileAsync = promisify(execFile);

export type PrereqEmitter = (update: PrereqResult) => void;

async function runTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, rej) => setTimeout(() => rej(new Error("timeout")), ms)),
  ]);
}

/** Check that the Claude CLI is on PATH. */
async function checkClaudeCli(): Promise<PrereqResult> {
  const resolved = await resolveBinary("claude");
  if (!resolved) {
    const npm = await resolveBinary("npm");

    return {
      id: "claude_cli",
      status: "fail",
      message: "Claude Code CLI is not on PATH",
      detail: npm
        ? "Install with: npm install -g @anthropic-ai/claude-code"
        : "npm not found — install Node.js first, then re-run.",
      fixable: !!npm,
    };
  }

  return {
    id: "claude_cli",
    status: "pass",
    message: resolved,
  };
}

/**
 * Ask one account's CLI to do the smallest possible thing. The output matters
 * as much as the exit code: a spent quota and a dead token both fail, and only
 * the text says which — otherwise every limit reads as "not authenticated".
 */
async function probeAccountAuth(id: string): Promise<AuthOutcome> {
  const collect = (err: unknown): string => {
    const e = err as { message?: string; stderr?: string; stdout?: string };

    return [e.stdout, e.stderr, e.message].filter(Boolean).join("\n");
  };

  try {
    const { stdout } = await runTimeout(execClaudePing(id), 12_000);
    const found = classifyRunFailure(stdout);
    if (found !== "unknown") {
      return found;
    }

    // The CLI can exit 0 with the failure inside the JSON envelope, so an
    // errored reply proves nothing about the credentials either way.
    return stdout.includes('"is_error":true') ? "unknown" : "ok";
  } catch (err) {
    return classifyRunFailure(collect(err));
  }
}

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
    { env, maxBuffer: 4 * 1024 * 1024, timeout: 12_000 },
  );
}

/** Name an account by, for a message that says which one to act on. */
function accountName(account: ClaudeAccount | undefined): string {
  return account?.label || account?.email || "The selected account";
}

/**
 * Auth check over *every* signed-in account, not just the selected one: the
 * selected account being out of quota is a different problem from having no way
 * to run agents at all. The selected one is probed alone first, so the healthy
 * common case stays a single API call.
 */
async function checkClaudeAuth(): Promise<PrereqResult> {
  const warn = (
    reason: ClaudeAuthReason,
    message: string,
    detail: string,
  ): PrereqResult => ({
    id: "claude_auth",
    status: "warn",
    message,
    detail,
    fixable: true,
    auth_reason: reason,
  });

  const accounts = listClaudeAccounts();
  if (accounts.length === 0) {
    return warn(
      "no_accounts",
      "No Claude account authenticated",
      "Sign in so Argus can spawn agents.",
    );
  }

  const activeId = getActiveAccountId();
  const active = accounts.find((a) => a.id === activeId);
  const outcomes = new Map<string, AuthOutcome>([
    [activeId, await probeAccountAuth(activeId)],
  ]);

  // Only pay for the rest when the selected account can't run anything.
  if (outcomes.get(activeId) !== "ok") {
    const others = accounts.filter((a) => a.id !== activeId);
    const found = await Promise.all(
      others.map(
        async (account) =>
          [account.id, await probeAccountAuth(account.id)] as const,
      ),
    );
    for (const [id, outcome] of found) {
      outcomes.set(id, outcome);
    }
  }
  // Badges a probe just moved would otherwise sit stale until something re-read
  // the list, so push the change rather than waiting for the next fetch.
  if (
    accounts.some((account) =>
      recordAuthOutcome(account.id, outcomes.get(account.id) ?? "unknown"),
    )
  ) {
    emitAccountsChanged();
  }

  // A probe that said nothing — offline, a hung CLI — falls back to the badge
  // the last real run left behind rather than guessing.
  const stands = (account: ClaudeAccount | undefined): AuthOutcome => {
    const probed = account && outcomes.get(account.id);
    if (probed && probed !== "unknown") {
      return probed;
    }
    if (account?.rate_limited) {
      return "rate_limited";
    }

    return account?.needs_reauth ? "reauth" : "unknown";
  };
  // The selected account may have no row at all (the CLI's own sign-in), in
  // which case only the probe says anything about it.
  const selected = stands(active);
  const usable = accounts.filter((a) => stands(a) === "ok").length;
  if (selected === "ok") {
    return { id: "claude_auth", status: "pass", message: "authenticated" };
  }
  if (selected === "unknown") {
    return warn(
      "unverifiable",
      "Could not verify the Claude account",
      "Re-check once you have network — the credentials may be fine.",
    );
  }

  const limited = selected === "rate_limited";

  // Another account works, so the selected one is the whole problem.
  if (usable > 0) {
    return warn(
      limited ? "selected_rate_limited" : "selected_signed_out",
      `${accountName(active)} is ${limited ? "out of usage" : "signed out"}`,
      "Another account is ready — switch to it to keep spawning agents.",
    );
  }

  return limited
    ? warn(
        "all_rate_limited",
        "Every Claude account has hit its usage limit",
        "Limits clear on their own, or add another account.",
      )
    : warn(
        "unauthenticated",
        "No Claude account can authenticate",
        "Sign in again to renew the credentials.",
      );
}

async function checkGitCli(): Promise<PrereqResult> {
  const resolved = await resolveBinary("git");
  if (!resolved) {
    return {
      id: "git_cli",
      status: "fail",
      message: "git is not on PATH",
      detail: "Install Xcode Command Line Tools: xcode-select --install",
    };
  }

  return { id: "git_cli", status: "pass", message: resolved };
}

async function checkGitIdentity(): Promise<PrereqResult> {
  try {
    const [{ stdout: name }, { stdout: email }] = await Promise.all([
      execFileAsync("git", ["config", "--global", "user.name"]),
      execFileAsync("git", ["config", "--global", "user.email"]),
    ]);
    if (!name.trim() || !email.trim()) {
      throw new Error("missing");
    }

    return {
      id: "git_identity",
      status: "pass",
      message: `${name.trim()} <${email.trim()}>`,
    };
  } catch {
    return {
      id: "git_identity",
      status: "fail",
      message: "Git user.name / user.email are not configured",
      fixable: true,
    };
  }
}

async function checkXcode(): Promise<PrereqResult> {
  if (process.platform !== "darwin") {
    return { id: "xcode", status: "skipped", mobileOnly: true };
  }
  try {
    const { stdout } = await execFileAsync("xcode-select", ["-p"]);
    const developerDir = stdout.trim();
    if (!developerDir) {
      throw new Error("no developer dir");
    }

    return { id: "xcode", status: "pass", message: developerDir };
  } catch {
    return {
      id: "xcode",
      status: "warn",
      message: "Xcode is not installed",
      detail:
        "Required for iOS simulator previews. Install from the App Store.",
      mobileOnly: true,
    };
  }
}

async function checkIosRuntimes(): Promise<PrereqResult> {
  if (process.platform !== "darwin") {
    return { id: "ios_runtimes", status: "skipped", mobileOnly: true };
  }
  try {
    const { stdout } = await execFileAsync("xcrun", [
      "simctl",
      "list",
      "runtimes",
      "--json",
    ]);
    const data = JSON.parse(stdout) as { runtimes: { name: string }[] };
    const iosCount = (data.runtimes ?? []).filter((r) =>
      r.name.toLowerCase().includes("ios"),
    ).length;
    if (iosCount === 0) {
      return {
        id: "ios_runtimes",
        status: "warn",
        message: "No iOS simulator runtimes installed",
        detail:
          "Click Fix to download the iOS simulator runtime via xcodebuild (multi-GB).",
        mobileOnly: true,
        fixable: true,
      };
    }

    return {
      id: "ios_runtimes",
      status: "pass",
      message: `${iosCount} runtime(s)`,
    };
  } catch {
    return {
      id: "ios_runtimes",
      status: "warn",
      message: "xcrun simctl is not available",
      mobileOnly: true,
    };
  }
}

async function checkAndroidSdk(): Promise<PrereqResult> {
  const adb = await resolveBinary("adb");
  if (!adb) {
    return {
      id: "android_sdk",
      status: "warn",
      message: "Android SDK / adb not on PATH",
      detail: "Install Android Studio or the platform-tools package.",
      mobileOnly: true,
    };
  }

  return { id: "android_sdk", status: "pass", message: adb };
}

async function checkAndroidAvd(): Promise<PrereqResult> {
  const emulator = await resolveBinary("emulator");
  if (!emulator) {
    return {
      id: "android_avd",
      status: "skipped",
      message: "`emulator` binary not found",
      mobileOnly: true,
    };
  }
  try {
    const { stdout } = await execFileAsync(emulator, ["-list-avds"]);
    const avds = stdout
      .split(/\r?\n/)
      .map((s) => s.trim())
      .filter(Boolean);
    if (avds.length === 0) {
      return {
        id: "android_avd",
        status: "warn",
        message: "No Android AVDs configured",
        mobileOnly: true,
      };
    }

    return {
      id: "android_avd",
      status: "pass",
      message: `${avds.length} AVD(s)`,
    };
  } catch {
    return {
      id: "android_avd",
      status: "warn",
      message: "Could not list AVDs",
      mobileOnly: true,
    };
  }
}

async function checkPlaywright(): Promise<PrereqResult> {
  // Playwright ships inside node_modules — only warn if the cache is missing
  const cacheDir = path.join(
    os.homedir(),
    "Library",
    "Caches",
    "ms-playwright",
  );
  if (!fs.existsSync(cacheDir)) {
    return {
      id: "playwright",
      status: "warn",
      message: "Playwright browser cache not found",
      detail: "Click Fix to run `npx playwright install`.",
      fixable: true,
    };
  }

  return { id: "playwright", status: "pass" };
}

const CHECKS: Record<PrereqId, () => Promise<PrereqResult>> = {
  claude_cli: checkClaudeCli,
  claude_auth: checkClaudeAuth,
  git_cli: checkGitCli,
  git_identity: checkGitIdentity,
  xcode: checkXcode,
  ios_runtimes: checkIosRuntimes,
  android_sdk: checkAndroidSdk,
  android_avd: checkAndroidAvd,
  playwright: checkPlaywright,
};

/**
 * Run all prereq checks in parallel. Emits `running` before each and the
 * resolved result after. Returns a summary array.
 */
export async function runPrereqChecks(
  emit: PrereqEmitter,
  ids?: PrereqId[],
): Promise<PrereqResult[]> {
  const targets = (ids ?? (Object.keys(CHECKS) as PrereqId[])).filter(
    (id) => id in CHECKS,
  );
  targets.forEach((id) => emit({ id, status: "running" }));

  const results = await Promise.all(
    targets.map(async (id) => {
      try {
        const r = await CHECKS[id]();
        emit(r);

        return r;
      } catch (err) {
        const r: PrereqResult = {
          id,
          status: "fail",
          message: err instanceof Error ? err.message : String(err),
        };
        emit(r);

        return r;
      }
    }),
  );

  return results;
}

/**
 * Apply an automated fix for a specific check, where one exists.
 * Long-running fixers stream a `running` update through `emit` so the UI can
 * surface progress. Returns `{ ok: true }` on success.
 */
export async function runPrereqFixer(
  id: PrereqId,
  args?: { gitName?: string; gitEmail?: string },
  emit?: PrereqEmitter,
): Promise<{ ok: boolean; error?: string }> {
  const progress = (message: string) =>
    emit?.({ id, status: "running", message });

  try {
    if (id === "git_identity") {
      if (!args?.gitName || !args?.gitEmail) {
        return { ok: false, error: "missing gitName or gitEmail" };
      }
      await execFileAsync("git", [
        "config",
        "--global",
        "user.name",
        args.gitName,
      ]);
      await execFileAsync("git", [
        "config",
        "--global",
        "user.email",
        args.gitEmail,
      ]);

      return { ok: true };
    }

    if (id === "claude_cli") {
      progress("Installing @anthropic-ai/claude-code (npm -g)…");
      await runTimeout(
        execFileAsync("npm", ["install", "-g", "@anthropic-ai/claude-code"]),
        180_000,
      );

      return { ok: true };
    }

    if (id === "playwright") {
      progress("Installing Playwright browsers…");
      await runTimeout(
        execFileAsync("npx", ["--yes", "playwright", "install"]),
        600_000,
      );

      return { ok: true };
    }

    if (id === "ios_runtimes") {
      progress("Downloading iOS simulator runtime (this can take a while)…");
      await runTimeout(
        execFileAsync("xcodebuild", ["-downloadPlatform", "iOS"]),
        1_800_000,
      );

      return { ok: true };
    }

    return { ok: false, error: `no fixer for ${id}` };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export async function claudePing(): Promise<{ ok: boolean; error?: string }> {
  const r = await checkClaudeAuth();

  return r.status === "pass"
    ? { ok: true }
    : { ok: false, error: r.message ?? "Claude ping failed" };
}
