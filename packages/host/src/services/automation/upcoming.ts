/**
 * What runs next across every automation and teammate duty, soonest first,
 * and what each one is waiting on. Read from the scheduler's own clock
 * (`next_run_at`) so this can never disagree with when a run actually fires.
 */

import type { Automation, AutomationRun } from "./models";
import { appState } from "../../state";
import { loadAppSettings } from "../appSettings/store";
import { getActiveAccountId, getClaudeAccount } from "../claudeAuth/accounts";
import { teammateCache } from "../teammate/registry";
import { teammatesActive } from "../teammate/settings";
import { capture as telemetryCapture } from "../telemetry/telemetry";
import { cachedAccountLimits } from "../usage/limits";
import { listAutomationRuns, listAutomations, nextRunFor } from "./manager";

/** Why the next run may not start on time. */
export type UpcomingWait = "approval" | "limit" | "overlap" | "paused";

export interface UpcomingRun {
  automation_id: string;
  name: string;
  /** The teammate it is a duty of, or null for a standalone automation. */
  teammate_id: string | null;
  teammate_name: string | null;
  trigger_kind: "once" | "schedule";
  /** When it fires next, epoch ms; when it would, for a paused one. */
  next_run_at: number;
  /** Null when nothing stands in its way. */
  waiting: UpcomingWait | null;
  /** When the wait ends, epoch ms, when known: a usage limit's reset. */
  waiting_until: number | null;
}

export interface UpcomingInputs {
  automations: Automation[];
  teammates: { id: string; name: string; enabled: boolean }[];
  automationsEnabled: boolean;
  teammatesActive: boolean;
  activeRuns: AutomationRun[];
  /** The agent has a permission prompt nobody answered. */
  awaitingApproval: (agentId: string) => boolean;
  /** The automation's Claude account is out of usage, and until when. */
  limit: (automation: Automation) => { resetsAt: number | null } | null;
  now: number;
}

export function computeUpcoming(inputs: UpcomingInputs): UpcomingRun[] {
  const teammates = new Map(inputs.teammates.map((t) => [t.id, t]));
  const out: UpcomingRun[] = [];
  for (const automation of inputs.automations) {
    const { trigger } = automation;
    if (trigger.kind !== "schedule" && trigger.kind !== "once") {
      continue;
    }
    const teammate = automation.teammate_id
      ? (teammates.get(automation.teammate_id) ?? null)
      : null;
    const paused =
      !automation.enabled ||
      !inputs.automationsEnabled ||
      (automation.teammate_id !== null &&
        (!inputs.teammatesActive || teammate?.enabled === false));
    // A paused one shows when it would run; a spent one-time trigger has none.
    const next =
      (automation.enabled ? automation.next_run_at : null) ??
      nextRunFor({ ...automation, enabled: true }, inputs.now);
    if (
      next === null ||
      (trigger.kind === "once" && !automation.enabled && next <= inputs.now)
    ) {
      continue;
    }
    const run = inputs.activeRuns.find(
      (r) => r.automation_id === automation.id,
    );
    let waiting: UpcomingWait | null = null;
    let waitingUntil: number | null = null;
    const limit = paused ? null : inputs.limit(automation);
    if (paused) {
      waiting = "paused";
    } else if (
      run?.host_agent_id &&
      inputs.awaitingApproval(run.host_agent_id)
    ) {
      waiting = "approval";
    } else if (limit) {
      waiting = "limit";
      waitingUntil = limit.resetsAt;
    } else if (run) {
      waiting = "overlap";
    }
    out.push({
      automation_id: automation.id,
      name: automation.name,
      teammate_id: automation.teammate_id,
      teammate_name: teammate?.name ?? null,
      trigger_kind: trigger.kind,
      next_run_at: next,
      waiting,
      waiting_until: waitingUntil,
    });
  }

  return out.sort(
    (a, b) => a.next_run_at - b.next_run_at || a.name.localeCompare(b.name),
  );
}

/** Only a Claude run waits on a Claude account's limit. */
function accountLimit(
  automation: Automation,
): { resetsAt: number | null } | null {
  if (automation.runner && automation.runner !== "claude-code") {
    return null;
  }
  const id = automation.claude_account_id ?? getActiveAccountId();
  if (!getClaudeAccount(id)?.rate_limited) {
    return null;
  }
  const spent = (cachedAccountLimits(id)?.windows ?? []).filter(
    (w) => w.used_percent >= 100 && w.resets_at !== null,
  );

  return {
    resetsAt: spent.length
      ? Math.max(...spent.map((w) => w.resets_at as number))
      : null,
  };
}

export function upcomingRuns(now: number = Date.now()): UpcomingRun[] {
  return computeUpcoming({
    automations: listAutomations(),
    teammates: teammateCache(),
    automationsEnabled: loadAppSettings().automations_enabled !== false,
    teammatesActive: teammatesActive(),
    activeRuns: listAutomationRuns().filter(
      (r) => r.status === "queued" || r.status === "running",
    ),
    awaitingApproval: (agentId) =>
      (appState.agentPendingPermissions.get(agentId)?.size ?? 0) > 0,
    limit: accountLimit,
    now,
  });
}

/** The Upcoming screen's list; counted when a screen opens on it. */
export function viewUpcoming(viewed: boolean): UpcomingRun[] {
  const runs = upcomingRuns();
  if (!viewed) {
    return runs;
  }
  telemetryCapture("upcoming_viewed", {
    count_bucket: countBucket(runs.length),
    waiting: runs.some((r) => r.waiting !== null && r.waiting !== "paused"),
  });

  return runs;
}

function countBucket(n: number): "0" | "1-5" | "6-20" | "21+" {
  if (n === 0) {
    return "0";
  }
  if (n <= 5) {
    return "1-5";
  }

  return n <= 20 ? "6-20" : "21+";
}
