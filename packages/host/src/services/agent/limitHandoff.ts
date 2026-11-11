/**
 * Which other signed-in Claude accounts an agent stalled on a spent plan limit
 * could move to. Only ever offered: people keep personal and work plans apart,
 * so the move itself (`handoffAgentToAccount`) is always the user's pick.
 */

import type {
  ClaudeAccountLimits,
  LimitHandoffAccount,
  UsageLimitWindow,
} from "@argus/remote-protocol";
import { appState } from "../../state";
import {
  type ClaudeAccount,
  listClaudeAccounts,
  resolveAccountForSession,
} from "../claudeAuth/accounts";
import { capture as telemetryCapture } from "../telemetry/telemetry";
import { getAccountLimits } from "../usage/limits";
import { endLimitStall, isLimitStalled } from "./limitResume";

/** How long the card waits on a usage probe before showing the account without numbers. */
const USAGE_WAIT_MS = 4_000;

function currentAccountId(agentId: string): string | null {
  const agent = appState.agents.get(agentId);
  if (!agent) {
    return null;
  }

  return (
    agent.accountId ??
    resolveAccountForSession(appState.sessions.get(agent.sessionId))
  );
}

/** Signed in, not the agent's own, and not known to be spent or logged out. */
export function handoffCandidates(agentId: string): ClaudeAccount[] {
  const current = currentAccountId(agentId);
  if (current === null) {
    return [];
  }

  return listClaudeAccounts().filter(
    (a) =>
      a.id !== current &&
      Boolean(a.email) &&
      !a.needs_reauth &&
      !a.rate_limited,
  );
}

/** The window closest to its limit, when the probe could read the plan. */
export function tightestWindow(
  limits: ClaudeAccountLimits | null,
): UsageLimitWindow | null {
  if (limits?.status !== "ok") {
    return null;
  }

  return limits.windows.reduce<UsageLimitWindow | null>(
    (worst, w) => (!worst || w.used_percent > worst.used_percent ? w : worst),
    null,
  );
}

function isSpent(window: UsageLimitWindow | null, now: number): boolean {
  return (
    window !== null &&
    window.used_percent >= 100 &&
    (window.resets_at === null || window.resets_at > now)
  );
}

async function limitsWithin(
  id: string,
  ms: number,
  refresh = false,
): Promise<ClaudeAccountLimits | null> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), ms);
  });
  try {
    return await Promise.race([
      getAccountLimits(id, refresh).catch(() => null),
      timeout,
    ]);
  } finally {
    clearTimeout(timer);
  }
}

/** The agent's own plan reads as having room again, so the stall is stale. */
async function ownPlanRecovered(agentId: string, now: number) {
  const current = currentAccountId(agentId);
  if (current === null) {
    return false;
  }
  // A cached reading may predate the refusal.
  const limits = await limitsWithin(current, USAGE_WAIT_MS, true);

  return limits?.status === "ok" && !isSpent(tightestWindow(limits), now);
}

/** The card's rows: empty unless the agent is stalled on a limit. */
export async function limitHandoffAccounts(
  agentId: string,
): Promise<LimitHandoffAccount[]> {
  if (!isLimitStalled(agentId)) {
    return [];
  }
  const candidates = handoffCandidates(agentId);
  if (candidates.length === 0) {
    return [];
  }
  const now = Date.now();
  const [recovered, rows] = await Promise.all([
    ownPlanRecovered(agentId, now),
    Promise.all(
      candidates.map(async (a) => {
        const label = a.label || a.email || "Claude";
        const usage = tightestWindow(await limitsWithin(a.id, USAGE_WAIT_MS));

        return {
          account_id: a.id,
          label,
          detail:
            (a.email && a.email !== label ? a.email : a.subscription_type) ??
            null,
          usage,
        };
      }),
    ),
  ]);
  if (recovered) {
    endLimitStall(agentId);

    return [];
  }

  return rows.filter((r) => !isSpent(r.usage, now));
}

function countBucket(n: number): "1" | "2" | "3+" {
  if (n >= 3) {
    return "3+";
  }

  return n === 2 ? "2" : "1";
}

/** A turn just stalled on the limit: count it as offered when there's somewhere to go. */
export function noteLimitStallStarted(agentId: string): void {
  const eligible = handoffCandidates(agentId).length;
  if (eligible > 0) {
    telemetryCapture("limit_handoff_offered", {
      eligible_count_bucket: countBucket(eligible),
    });
  }
}
