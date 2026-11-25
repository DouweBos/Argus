/**
 * The usage warning: a needs-you notification, once per window, when a plan
 * limit in use reaches `usage_warning_percent`. It rides the agent
 * notification path, so this Mac, phones and browsers each get it under their
 * own Needs you choice, with Switch when another Claude account has room.
 */

import type {
  ClaudeAccountLimits,
  RunnerUsageLimits,
  UsageLimitWindow,
} from "@argus/remote-protocol";
import { addHostEventSink } from "@argus/host/bus";
import { warn } from "@argus/host/logger";
import { appState } from "../../state";
import { isAgentBusy } from "../agent/busy";
import { pickAutoSwitchAccount } from "../agent/limitAutoSwitch";
import { limitsWithin, tightestWindow } from "../agent/limitHandoff";
import { loadAppSettings } from "../appSettings/store";
import {
  getActiveAccountId,
  listClaudeAccounts,
  resolveAccountForSession,
} from "../claudeAuth/accounts";
import { getRunnerById } from "../llm/registry";
import { switchAccountActions } from "../notifications/actions";
import { presentNotification } from "../notifications/osNotification";
import { capture } from "../telemetry/telemetry";
import { getAccountLimits } from "./limits";
import {
  getRunnerLimits,
  isPlanRunner,
  onRunnerUsageLimits,
  type PlanRunner,
} from "./runnerLimits";
import { loadFiredWarnings, saveFiredWarnings } from "./usageWarningLog";
import {
  dueWarnings,
  type FiredWarnings,
  pruneFired,
  thresholdBucket,
  usageWarningThreshold,
  warningText,
} from "./usageWarnings";

const CLAUDE = "claude-code";
/** Running agents' plans are read this often, so a warning doesn't wait for the Usage screen. */
const POLL_MS = 10 * 60_000;
const SWITCH_PROBE_MS = 4_000;

let fired: FiredWarnings | null = null;
let chain: Promise<void> = Promise.resolve();

/** One check at a time: two readings racing would both see the window unwarned. */
function enqueue(job: () => Promise<void>): void {
  chain = chain.then(job).catch((e: unknown) => {
    warn(`[usage] usage warning failed: ${String(e)}`);
  });
}

function threshold(): number | null {
  return usageWarningThreshold(loadAppSettings().usage_warning_percent);
}

function accountOf(agentId: string): string | null {
  const agent = appState.agents.get(agentId);
  if (!agent || agent.runner.id !== CLAUDE) {
    return null;
  }

  return (
    agent.accountId ??
    resolveAccountForSession(appState.sessions.get(agent.sessionId))
  );
}

/** Only accounts work runs on: the active one, or one a live agent still uses. */
function claudeAccountInUse(accountId: string): boolean {
  if (accountId === getActiveAccountId()) {
    return true;
  }
  for (const agent of appState.agents.values()) {
    if (
      agent.status !== "stopped" &&
      agent.status !== "error" &&
      accountOf(agent.agentId) === accountId
    ) {
      return true;
    }
  }

  return false;
}

/** The signed-in account with the most room left, if it's under the threshold. */
async function switchTarget(
  fromId: string,
  limit: number,
): Promise<{ id: string; label: string } | null> {
  const others = listClaudeAccounts().filter(
    (a) =>
      a.id !== fromId && Boolean(a.email) && !a.needs_reauth && !a.rate_limited,
  );
  const rows = await Promise.all(
    others.map(async (a) => ({
      account_id: a.id,
      label: a.label || a.email || "Claude",
      detail: null,
      usage: tightestWindow(await limitsWithin(a.id, SWITCH_PROBE_MS)),
    })),
  );
  const best = pickAutoSwitchAccount(rows);

  return best?.usage && best.usage.used_percent < limit
    ? { id: best.account_id, label: best.label }
    : null;
}

interface Reading {
  runner: PlanRunner | typeof CLAUDE;
  accountId: string | null;
  windows: UsageLimitWindow[];
}

async function check(reading: Reading): Promise<void> {
  const limit = threshold();
  if (limit === null) {
    return;
  }
  const now = Date.now();
  const result = dueWarnings(
    reading.runner,
    reading.accountId,
    reading.windows,
    limit,
    (fired ??= loadFiredWarnings()),
    now,
  );
  if (result.changed) {
    fired = pruneFired(result.fired, now);
    saveFiredWarnings(fired);
  }
  const window = result.due[0];
  if (!window) {
    return;
  }

  const claudeAccounts = listClaudeAccounts();
  const account =
    reading.runner === CLAUDE && claudeAccounts.length > 1
      ? claudeAccounts.find((a) => a.id === reading.accountId)
      : undefined;
  // Moving the active account only helps when it's the one running low.
  const target =
    reading.runner === CLAUDE &&
    reading.accountId !== null &&
    reading.accountId === getActiveAccountId()
      ? await switchTarget(reading.accountId, limit)
      : null;
  const text = warningText({
    runnerLabel: getRunnerById(reading.runner)?.displayName ?? reading.runner,
    accountLabel: account ? account.label || account.email || null : null,
    window,
    switchLabel: target?.label ?? null,
    now,
  });
  presentNotification(
    {
      agent_id: null,
      session_id: null,
      tool_use_id: null,
      kind: "usage",
      ...text,
      account_id: target?.id ?? null,
      actions: switchAccountActions(target?.label ?? null),
    },
    { showLocal: true },
  );
  capture("usage_warning_sent", {
    runner: reading.runner,
    threshold_bucket: thresholdBucket(limit),
    switch_offered: target !== null,
  });
}

function onClaudeLimits(limits: ClaudeAccountLimits): void {
  if (limits.status !== "ok" || !claudeAccountInUse(limits.account_id)) {
    return;
  }
  enqueue(() =>
    check({
      runner: CLAUDE,
      accountId: limits.account_id,
      windows: limits.windows,
    }),
  );
}

function onRunnerLimits(limits: RunnerUsageLimits): void {
  if (limits.status !== "ok" || !isPlanRunner(limits.runner)) {
    return;
  }
  const runner = limits.runner;
  enqueue(() => check({ runner, accountId: null, windows: limits.windows }));
}

/** Read the plans busy agents run on; cached readings cost nothing. */
function pollBusyPlans(): void {
  if (threshold() === null) {
    return;
  }
  const accounts = new Set<string>();
  const runners = new Set<PlanRunner>();
  for (const agent of appState.agents.values()) {
    if (!isAgentBusy(agent)) {
      continue;
    }
    const account = accountOf(agent.agentId);
    if (account !== null) {
      accounts.add(account);
    } else if (isPlanRunner(agent.runner.id)) {
      runners.add(agent.runner.id);
    }
  }
  for (const id of accounts) {
    getAccountLimits(id).then(onClaudeLimits, () => undefined);
  }
  for (const runner of runners) {
    getRunnerLimits(runner).then(onRunnerLimits, () => undefined);
  }
}

let detach: (() => void)[] = [];
let timer: NodeJS.Timeout | null = null;

export function startUsageWarnings(): void {
  if (timer) {
    return;
  }
  detach = [
    addHostEventSink((channel, args) => {
      if (channel === "usage:limits-changed" && args[0]) {
        onClaudeLimits(args[0] as ClaudeAccountLimits);
      }
    }),
    onRunnerUsageLimits(onRunnerLimits),
  ];
  timer = setInterval(pollBusyPlans, POLL_MS);
  timer.unref();
}

export function stopUsageWarnings(): void {
  for (const off of detach) {
    off();
  }
  detach = [];
  fired = null;
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}
