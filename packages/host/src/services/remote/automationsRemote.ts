/**
 * Automations, narrowed for a phone.
 *
 * A paired desktop drives the host's automations through the admin
 * passthrough — raw IPC, the whole `Automation`. A phone cannot: it speaks the
 * typed method vocabulary, and it wants to see what fired overnight and press
 * Run now, not edit a playbook. So this maps the host records onto the small
 * wire shapes in `@argus/remote-protocol` and nothing more.
 *
 * Every method here is `denied` for a scoped grant (see `METHOD_SCOPE`): a
 * huddle guest is handed one agent, never the clock behind it.
 */

import type { Automation, AutomationRun } from "../automation/models";
import type {
  RemoteAutomation,
  RemoteAutomationRun,
} from "@argus/remote-protocol";
import path from "node:path";
import {
  getAutomation,
  getAutomationRun,
  hasActiveRun,
  listAutomationRuns,
  listAutomations,
  hasUnreadReport,
  markRunReportRead,
} from "../automation/manager";

/** How many runs a client gets when it doesn't say. */
const DEFAULT_RUN_LIMIT = 30;

function toRemoteAutomation(automation: Automation): RemoteAutomation {
  const { trigger } = automation;

  return {
    id: automation.id,
    name: automation.name,
    description: automation.description,
    enabled: automation.enabled,
    trigger_kind: trigger.kind,
    cron: trigger.kind === "schedule" ? trigger.cron : null,
    timezone: trigger.kind === "schedule" ? trigger.timezone : null,
    autonomy: automation.autonomy,
    projects: automation.scope.repo_roots.map((root) => path.basename(root)),
    last_run_at: automation.last_run_at,
    next_run_at: automation.next_run_at,
    running: hasActiveRun(automation.id),
  };
}

/**
 * A quick run's `automation_id` points at a synthetic spec that is not in
 * `automations.json`, so its name comes off the run itself.
 */
function runName(run: AutomationRun): string {
  if (run.scratch) {
    return run.scratch.name || "Quick run";
  }

  return getAutomation(run.automation_id)?.name ?? "Automation";
}

export function toRemoteAutomationRun(run: AutomationRun): RemoteAutomationRun {
  return {
    id: run.id,
    automation_id: run.automation_id,
    automation_name: runName(run),
    is_quick: run.scratch !== null,
    status: run.status,
    trigger_reason: run.trigger_reason,
    started_at: run.started_at,
    finished_at: run.finished_at,
    cost_usd: run.cost_usd,
    error: run.error,
    unread_report: hasUnreadReport(run),
    host_session_id: run.host_session_id,
    host_agent_id: run.host_agent_id,
  };
}

export function remoteAutomations(): { automations: RemoteAutomation[] } {
  return { automations: listAutomations().map(toRemoteAutomation) };
}

/** Newest first, so a client that takes the head takes the latest. */
export function remoteAutomationRuns(params: {
  automation_id?: string;
  limit?: number;
}): { runs: RemoteAutomationRun[] } {
  const runs = [...listAutomationRuns(params.automation_id)]
    .sort((a, b) => b.started_at - a.started_at)
    .slice(0, params.limit ?? DEFAULT_RUN_LIMIT);

  return { runs: runs.map(toRemoteAutomationRun) };
}

/** One run with its report. Null when the run id is unknown. */
export function remoteAutomationRun(runId: string): {
  report_blocks: AutomationRun["report_blocks"];
  report_markdown: string | null;
  run: RemoteAutomationRun;
} | null {
  const run = getAutomationRun(runId);
  if (!run) {
    return null;
  }

  return {
    run: toRemoteAutomationRun(run),
    report_blocks: run.report_blocks ?? null,
    report_markdown: run.report_markdown,
  };
}

/**
 * Reading a report on a phone reads it everywhere — there is one inbox, and
 * the desktop is watching the same bus. Null when the run is unknown.
 */
export function markRemoteRunRead(
  runId: string,
): { run: RemoteAutomationRun } | null {
  if (!getAutomationRun(runId)) {
    return null;
  }

  return { run: toRemoteAutomationRun(markRunReportRead(runId)) };
}
