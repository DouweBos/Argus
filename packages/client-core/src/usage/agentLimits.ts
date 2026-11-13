/**
 * The plan limits of the runner one agent runs on, for the composer's
 * `/usage-limits` panel: Claude Code's accounts (pooled when several), or the
 * runner's own windows.
 */

import type { ClaudeUsageLimits } from "@argus/remote-protocol";
import { DEFAULT_MODEL_RUNNER } from "./usageModelDetail";
import {
  claudePoolAccounts,
  usagePoolViews,
  type UsagePoolView,
} from "./usagePools";
import {
  usageAccountViews,
  usageRunnerLimitViews,
  type UsageAccountView,
} from "./usageViews";

/** Runners the host reads plan limits for besides Claude Code. */
const PLAN_RUNNERS = ["antigravity", "codex", "cursor", "grok", "opencode"];

export interface AgentLimitsView {
  /** "Claude Code", "Codex". */
  title: string;
  /** Several Claude accounts pooled per window; null otherwise. */
  pools: UsagePoolView[] | null;
  /** The accounts or the runner, as the Limits tab shows them. */
  accounts: UsageAccountView[];
}

/** Whether to offer the command; before the first answer, by what the host can read. */
export function runnerHasLimits(
  limits: ClaudeUsageLimits | null,
  runnerId: string | undefined,
): boolean {
  const runner = runnerId ?? DEFAULT_MODEL_RUNNER;
  if (!limits) {
    return runner === DEFAULT_MODEL_RUNNER || PLAN_RUNNERS.includes(runner);
  }
  if (runner === DEFAULT_MODEL_RUNNER) {
    return limits.accounts.some((a) => a.status !== "unsupported");
  }

  return (limits.runners ?? []).some(
    (r) => r.runner === runner && r.status !== "unsupported",
  );
}

export function agentLimitsView(
  limits: ClaudeUsageLimits,
  runnerId: string | undefined,
  now: number,
): AgentLimitsView | null {
  const runner = runnerId ?? DEFAULT_MODEL_RUNNER;
  if (runner === DEFAULT_MODEL_RUNNER) {
    const accounts = usageAccountViews(limits, now);

    return accounts.length > 0
      ? {
          title: "Claude Code",
          pools: usagePoolViews(claudePoolAccounts(limits.accounts), now),
          accounts,
        }
      : null;
  }
  const view = usageRunnerLimitViews(limits, now).find((r) => r.id === runner);

  return view ? { title: view.label, pools: null, accounts: [view] } : null;
}
