/**
 * Automations, narrowed for a phone.
 *
 * A paired desktop drives the host's automations through the admin
 * passthrough — raw IPC, the whole `Automation`. A phone cannot: it speaks the
 * typed method vocabulary. So this maps the host records onto the small wire
 * shapes in `@argus/remote-protocol` — the list stays cheap, and the editable
 * half is fetched only for the automation actually being opened.
 *
 * Every method here is `denied` for a scoped grant (see `METHOD_SCOPE`): a
 * huddle guest is handed one agent, never the clock behind it.
 */

import type {
  Automation,
  AutomationRun,
  CreateAutomationInput,
  UpdateAutomationInput,
} from "../automation/models";
import type {
  AutomationInput,
  RemoteAutomation,
  RemoteAutomationGuardrails,
  RemoteAutomationDetail,
  RemoteAutomationRun,
  RemoteRunFeedback,
  RemoteRunner,
  RemoteSignalSource,
} from "@argus/remote-protocol";
import path from "node:path";
import { submitRunFeedback } from "../automation/feedback";
import {
  createAutomation,
  deleteAutomation,
  getAutomation,
  getAutomationRun,
  hasActiveRun,
  listAutomationRuns,
  listAutomations,
  hasUnreadReport,
  markRunReportRead,
  requireAutomation,
  updateAutomation,
} from "../automation/manager";
import {
  saveScratchRunAsAutomation,
  startScratchRun,
} from "../automation/scratch";
import { listRunners } from "../llm/registry";
import { describeSignalSources } from "../signals/registry";

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

function toRemoteAutomationDetail(
  automation: Automation,
): RemoteAutomationDetail {
  const { trigger } = automation;

  return {
    id: automation.id,
    name: automation.name,
    description: automation.description,
    enabled: automation.enabled,
    trigger_kind: trigger.kind,
    cron: trigger.kind === "schedule" ? trigger.cron : null,
    timezone: trigger.kind === "schedule" ? trigger.timezone : null,
    catch_up: trigger.kind === "schedule" ? trigger.catch_up : true,
    repo_roots: automation.scope.repo_roots,
    source_ids: automation.source_ids,
    playbook: automation.playbook,
    extra_instructions: automation.extra_instructions,
    autonomy: automation.autonomy,
    model: automation.model,
    runner: automation.runner ?? null,
    guardrails: automation.guardrails,
  };
}

/** The wire shape carries the trigger flat; the host keeps it as a union. */
function toTrigger(input: AutomationInput): Automation["trigger"] {
  return input.trigger_kind === "schedule"
    ? {
        kind: "schedule",
        cron: input.cron,
        timezone: input.timezone,
        catch_up: input.catch_up,
      }
    : { kind: "manual" };
}

function both(automation: Automation): {
  automation: RemoteAutomation;
  detail: RemoteAutomationDetail;
} {
  return {
    automation: toRemoteAutomation(automation),
    detail: toRemoteAutomationDetail(automation),
  };
}

export function remoteAutomation(
  id: string,
): { automation: RemoteAutomationDetail } | null {
  const automation = getAutomation(id);

  return automation
    ? { automation: toRemoteAutomationDetail(automation) }
    : null;
}

export async function remoteSignalSources(): Promise<{
  sources: RemoteSignalSource[];
}> {
  return { sources: await describeSignalSources() };
}

/** Runners an automation may be pinned to, for the phone's editor. */
export function remoteRunners(): { runners: RemoteRunner[] } {
  return {
    runners: listRunners().map((runner) => ({
      id: runner.id,
      display_name: runner.displayName,
      is_custom: runner.isCustom ?? false,
      default_model: runner.defaultModel?.() ?? null,
      models: (runner.models?.() ?? []).map((model) => ({
        value: model.value,
        display_name: model.displayName,
        description: model.description ?? null,
      })),
    })),
  };
}

export function createRemoteAutomation(input: AutomationInput): {
  automation: RemoteAutomation;
  detail: RemoteAutomationDetail;
} {
  const create: CreateAutomationInput = {
    name: input.name,
    description: input.description,
    enabled: input.enabled,
    trigger: toTrigger(input),
    scope: { repo_roots: input.repo_roots },
    source_ids: input.source_ids,
    playbook: input.playbook,
    extra_instructions: input.extra_instructions,
    autonomy: input.autonomy,
    guardrails: input.guardrails,
    model: input.model,
    runner: input.runner ?? null,
  };

  return both(createAutomation(create));
}

/**
 * Only the fields the client sent are touched — an editor that never showed
 * the playbook must not be able to blank it by omission.
 */
export function updateRemoteAutomation(
  id: string,
  patch: Partial<AutomationInput>,
): { automation: RemoteAutomation; detail: RemoteAutomationDetail } {
  const current = requireAutomation(id);
  const update: UpdateAutomationInput = {
    ...(patch.name !== undefined && { name: patch.name }),
    ...(patch.description !== undefined && { description: patch.description }),
    ...(patch.enabled !== undefined && { enabled: patch.enabled }),
    ...(patch.repo_roots !== undefined && {
      scope: { repo_roots: patch.repo_roots },
    }),
    ...(patch.source_ids !== undefined && { source_ids: patch.source_ids }),
    ...(patch.playbook !== undefined && { playbook: patch.playbook }),
    ...(patch.extra_instructions !== undefined && {
      extra_instructions: patch.extra_instructions,
    }),
    ...(patch.autonomy !== undefined && { autonomy: patch.autonomy }),
    ...(patch.model !== undefined && { model: patch.model }),
    ...(patch.runner !== undefined && { runner: patch.runner ?? null }),
    // Merged, so a guardrail an older phone doesn't know about survives its save.
    ...(patch.guardrails !== undefined && {
      guardrails: { ...current.guardrails, ...patch.guardrails },
    }),
  };

  // The trigger is four wire fields; rebuild it from the current one so a
  // partial patch can change the cron without restating the timezone.
  const schedule = current.trigger.kind === "schedule" ? current.trigger : null;
  const touchesTrigger =
    patch.trigger_kind !== undefined ||
    patch.cron !== undefined ||
    patch.timezone !== undefined ||
    patch.catch_up !== undefined;
  if (touchesTrigger) {
    update.trigger = toTrigger({
      trigger_kind: patch.trigger_kind ?? current.trigger.kind,
      cron: patch.cron ?? schedule?.cron ?? "",
      timezone: patch.timezone ?? schedule?.timezone ?? "UTC",
      catch_up: patch.catch_up ?? schedule?.catch_up ?? true,
    } as AutomationInput);
  }

  return both(updateAutomation(id, update));
}

export function deleteRemoteAutomation(id: string): { accepted: boolean } {
  requireAutomation(id);
  deleteAutomation(id);

  return { accepted: true };
}

export function setRemoteAutomationEnabled(
  id: string,
  enabled: boolean,
): { automation: RemoteAutomation } {
  return {
    automation: toRemoteAutomation(updateAutomation(id, { enabled })),
  };
}

/**
 * Run a playbook once. The run is modelled as a synthetic automation host-side,
 * so the ladder, the guardrails and the spend ceilings apply exactly as they do
 * to a scheduled run — a refusal comes back as a `skipped` run, not an error.
 */
export function startRemoteScratchRun(input: {
  guardrails: RemoteAutomationGuardrails;
  model: string | null;
  name?: string;
  playbook: string;
  repo_roots: string[];
  source_ids: string[];
}): { run: RemoteAutomationRun } {
  const run = startScratchRun({
    name: input.name,
    playbook: input.playbook,
    repo_roots: input.repo_roots,
    source_ids: input.source_ids,
    model: input.model,
    guardrails: input.guardrails,
  });

  return { run: toRemoteAutomationRun(run) };
}

/** Keep a one-off: the bridge from "that was useful" to an automation. */
export function saveRemoteScratchRun(
  runId: string,
  overrides: { description?: string; enabled?: boolean; name?: string },
): { automation: RemoteAutomation } {
  return {
    automation: toRemoteAutomation(
      saveScratchRunAsAutomation(runId, overrides),
    ),
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
  feedback: RemoteRunFeedback[];
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
    feedback: run.feedback ?? [],
  };
}

/**
 * Argue with a report from the phone. Same deal as on the desktop: the run's
 * own agent is picked back up, and unless `allow_clearing` was asked for it
 * may only add to the inbox.
 */
export async function submitRemoteRunFeedback(params: {
  allow_clearing?: boolean;
  note: string;
  run_id: string;
}): Promise<{ run: RemoteAutomationRun }> {
  const run = await submitRunFeedback({
    runId: params.run_id,
    note: params.note,
    allowClearing: params.allow_clearing,
  });

  return { run: toRemoteAutomationRun(run) };
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
