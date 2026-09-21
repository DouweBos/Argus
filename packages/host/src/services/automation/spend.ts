/**
 * What automations have cost, and what that forbids.
 *
 * Two limits were declared long before anything read them: a per-run ceiling
 * (`guardrails.max_cost_usd_per_run`) and an app-wide daily budget
 * (`automation_daily_budget_usd`). Both are accounted here, from the only
 * numbers that are real — the `total_cost_usd` each agent turn reports.
 *
 * A run's spend is its host agent plus every agent in the sessions that run
 * started, so a cheap orchestrator fanning out into expensive children is
 * counted as what it is.
 */

import { appState } from "../../state";
import { loadAppSettings } from "../appSettings/store";
import { listAutomationRuns } from "./manager";
import { listOwnedSessions } from "./ownedSessions";

/** The app-wide daily budget in USD. 0 (or unset) means no budget. */
export function dailyBudgetUsd(): number {
  const configured = loadAppSettings().automation_daily_budget_usd;

  return typeof configured === "number" && configured > 0 ? configured : 0;
}

function startOfDay(at: number): number {
  const date = new Date(at);
  date.setHours(0, 0, 0, 0);

  return date.getTime();
}

/**
 * Recorded spend for runs that started today, plus what today's runs have
 * spent so far — a run only records `cost_usd` when it finishes, so the
 * in-flight ones have to be measured live or a budget could be blown by a
 * single long morning.
 */
export function automationSpendTodayUsd(now: number = Date.now()): number {
  const since = startOfDay(now);
  let total = 0;
  for (const run of listAutomationRuns()) {
    if (run.started_at < since) {
      continue;
    }
    total +=
      run.finished_at === null ? runSpendUsd(run.id) : (run.cost_usd ?? 0);
  }

  return total;
}

/** Live spend of one run: its host agent plus the agents it started. */
export function runSpendUsd(runId: string): number {
  const run = listAutomationRuns().find((r) => r.id === runId);
  if (!run) {
    return 0;
  }

  const sessionIds = new Set<string>(
    listOwnedSessions(run.automation_id)
      .filter((s) => s.run_id === runId)
      .map((s) => s.session_id),
  );
  if (run.host_session_id) {
    sessionIds.add(run.host_session_id);
  }

  let total = 0;
  for (const agent of appState.agents.values()) {
    if (sessionIds.has(agent.sessionId) && Number.isFinite(agent.costUsd)) {
      total += agent.costUsd;
    }
  }

  // A finished run's agents are gone from `appState`; fall back to the record.
  return Math.max(total, run.cost_usd ?? 0);
}

/** Why today's budget forbids more work, or null when it allows it. */
export function dailyBudgetBlock(now: number = Date.now()): string | null {
  const budget = dailyBudgetUsd();
  if (budget === 0) {
    return null;
  }
  const spent = automationSpendTodayUsd(now);
  if (spent < budget) {
    return null;
  }

  return `automations have spent $${spent.toFixed(2)} today, at or over the daily budget of $${budget.toFixed(2)}`;
}

/** Why this run's own ceiling forbids more work, or null when it allows it. */
export function runBudgetBlock(
  runId: string,
  maxCostUsdPerRun: number,
): string | null {
  if (maxCostUsdPerRun <= 0) {
    return null;
  }
  const spent = runSpendUsd(runId);
  if (spent < maxCostUsdPerRun) {
    return null;
  }

  return `this run has spent $${spent.toFixed(2)}, at or over its ceiling of $${maxCostUsdPerRun.toFixed(2)}`;
}
