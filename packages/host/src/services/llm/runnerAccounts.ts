/**
 * Which runners are installed and signed in, for the Accounts page: one entry
 * per runner Argus can sign in to, Claude Code excluded (its accounts have a
 * section of their own).
 */

import type { LlmRunner, RunnerAuthProbe, RunnerSetup } from "./runners/types";
import { TELEMETRY_RUNNERS, type TelemetryRunner } from "../../telemetryEvents";
import { capture } from "../telemetry/telemetry";
import { CUSTOM_ACP_BASE_ID } from "./customRunners/store";
import {
  forgetRunnerAvailability,
  listRunners,
  runnerAvailability,
} from "./registry";

export type RunnerAccountStatus =
  | "not_installed"
  | "signed_in"
  | "signed_out"
  | "unknown";

export interface RunnerAccount {
  id: string;
  displayName: string;
  /** A user's own ACP agent. */
  isCustom: boolean;
  status: RunnerAccountStatus;
  /** Email, account or plan, when the CLI reports one. */
  account: string | null;
  /** How to install it, when it isn't. */
  detail: string | null;
  /** Whether the CLI can be asked; false means signed-in is always unknown. */
  canProbe: boolean;
  setup: RunnerSetup | null;
}

const AUTH_TTL_MS = 60_000;
const auth = new Map<
  string,
  { at: number; result: Promise<RunnerAuthProbe> }
>();

/** Drop a runner's cached sign-in, e.g. after its setup terminal exits. */
export function forgetRunnerAuth(runnerId: string): void {
  auth.delete(runnerId);
}

/** Runners shown on the Accounts page: built-ins besides Claude Code, and custom ACP agents. */
export function accountRunners(): LlmRunner[] {
  return listRunners().filter(
    (r) =>
      r.id !== "claude-code" &&
      (!r.isCustom || r.baseRunnerId === CUSTOM_ACP_BASE_ID),
  );
}

export async function listRunnerAccounts(
  opts: { refresh?: boolean; runnerId?: string } = {},
  now = Date.now(),
): Promise<RunnerAccount[]> {
  const runners = accountRunners();
  if (opts.refresh) {
    for (const r of runners) {
      if (!opts.runnerId || r.id === opts.runnerId) {
        forgetRunnerAvailability(r.id);
        forgetRunnerAuth(r.id);
      }
    }
  }
  const avail = await runnerAvailability(now);
  const accounts = await Promise.all(
    runners.map(async (r): Promise<RunnerAccount> => {
      const a = avail.get(r.id);
      const installed = a?.available ?? false;
      const probe = installed ? await probeAuth(r, now) : null;

      return {
        id: r.id,
        displayName: r.displayName,
        isCustom: r.isCustom ?? false,
        status: statusOf(installed, probe),
        account: probe?.account ?? null,
        detail: installed ? null : (a?.unavailableReason ?? null),
        canProbe: Boolean(r.authStatus),
        setup: r.setup?.() ?? null,
      };
    }),
  );

  return sortRunnerAccounts(accounts);
}

/** The list, and when one runner was re-probed by hand, what it found. */
export async function checkRunnerAccounts(opts: {
  refresh?: boolean;
  runnerId?: string;
}): Promise<RunnerAccount[]> {
  const accounts = await listRunnerAccounts(opts);
  const checked = opts.refresh && accounts.find((a) => a.id === opts.runnerId);
  if (checked) {
    capture("runner_account_action", {
      runner: telemetryRunner(checked.id),
      action: "check_again",
      outcome: checked.status,
    });
  }

  return accounts;
}

/** Installed runners first, keeping the registry's order within each half. */
export function sortRunnerAccounts(accounts: RunnerAccount[]): RunnerAccount[] {
  const installed = accounts.filter((a) => a.status !== "not_installed");
  const missing = accounts.filter((a) => a.status === "not_installed");

  return [...installed, ...missing];
}

function statusOf(
  installed: boolean,
  probe: RunnerAuthProbe | null,
): RunnerAccountStatus {
  if (!installed) {
    return "not_installed";
  }
  if (probe?.signedIn === true) {
    return "signed_in";
  }

  return probe?.signedIn === false ? "signed_out" : "unknown";
}

async function probeAuth(
  runner: LlmRunner,
  now: number,
): Promise<RunnerAuthProbe | null> {
  if (!runner.authStatus) {
    return null;
  }
  let entry = auth.get(runner.id);
  if (!entry || now - entry.at > AUTH_TTL_MS) {
    entry = {
      at: now,
      result: runner
        .authStatus()
        .catch((): RunnerAuthProbe => ({ signedIn: null, account: null })),
    };
    auth.set(runner.id, entry);
  }

  return entry.result;
}

export function telemetryRunner(runnerId: string): TelemetryRunner {
  return TELEMETRY_RUNNERS.find((id) => id === runnerId) ?? "custom";
}
