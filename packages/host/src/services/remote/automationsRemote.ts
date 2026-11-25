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
import type { RunnerSetup } from "../llm/runners/types";
import type {
  AutomationInput,
  RemoteAutomation,
  RemoteAutomationGuardrails,
  RemoteAutomationDetail,
  RemoteAutomationRun,
  RemoteRunFeedback,
  RemoteRunner,
  RemoteSignalSource,
  RemoteSignalTrigger,
  RemoteWebhookTrigger,
  SlackChannelRef,
  SlackTriggerMatch,
} from "@argus/remote-protocol";
import path from "node:path";
import { lastKnownModels } from "../agent/startOptions";
import { draftAutomation } from "../automation/authoring";
import { submitRunFeedback } from "../automation/feedback";
import { normalizeGuardrails } from "../automation/guardrails";
import {
  createAutomation,
  deleteAutomation,
  getAutomation,
  getAutomationRun,
  hasActiveRun,
  listAutomationRuns,
  listAutomations,
  listScratchRuns,
  hasUnreadReport,
  markRunReportRead,
  requireAutomation,
  updateAutomation,
} from "../automation/manager";
import { normalizePrecheckTimeout } from "../automation/precheck";
import { reportPreview } from "../automation/reportPreview";
import {
  saveScratchRunAsAutomation,
  startScratchRun,
} from "../automation/scratch";
import { DEFAULT_RUNS_PER_HOUR } from "../automation/signalTrigger";
import { slackTrigger } from "../automation/slackTrigger";
import {
  hasWebhookSecret,
  rotateWebhookSecret,
  webhookUrl,
} from "../automation/webhook";
import { listRunners, runnerAvailability } from "../llm/registry";
import { describeSignalSources } from "../signals/registry";

/** How many runs a client gets when it doesn't say. */
const DEFAULT_RUN_LIMIT = 30;

export function toRemoteAutomation(automation: Automation): RemoteAutomation {
  const { trigger } = automation;

  return {
    id: automation.id,
    name: automation.name,
    description: automation.description,
    enabled: automation.enabled,
    ...wireTrigger(trigger, automation.id),
    autonomy: automation.autonomy,
    projects: automation.scope.repo_roots.map((root) => path.basename(root)),
    last_run_at: automation.last_run_at,
    next_run_at: automation.next_run_at,
    running: hasActiveRun(automation.id),
    teammate_id: automation.teammate_id,
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
    report_read: run.report_read,
    report_preview: reportPreview(run),
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
    ...wireTrigger(trigger, automation.id),
    repo_roots: automation.scope.repo_roots,
    source_ids: automation.source_ids,
    playbook: automation.playbook,
    extra_instructions: automation.extra_instructions,
    autonomy: automation.autonomy,
    model: automation.model,
    runner: automation.runner ?? null,
    claude_account_id: automation.claude_account_id ?? null,
    report_slack_channel: automation.report_slack_channel ?? null,
    guardrails: automation.guardrails,
    precheck_command: automation.precheck_command,
    precheck_timeout_seconds: automation.precheck_timeout_seconds,
  };
}

/** The union, flattened into the wire's trigger fields. */
function wireTrigger(
  trigger: Automation["trigger"],
  automationId: string,
): {
  catch_up: boolean;
  cron: string | null;
  run_at: string | null;
  signal: RemoteSignalTrigger | null;
  timezone: string | null;
  trigger_kind: Automation["trigger"]["kind"];
  webhook: RemoteWebhookTrigger | null;
  slack_channel: SlackChannelRef | null;
  slack_match: SlackTriggerMatch | null;
  slack_text: string | null;
} {
  const clock =
    trigger.kind === "schedule" || trigger.kind === "once" ? trigger : null;
  const slack = trigger.kind === "slack" ? trigger : null;

  return {
    trigger_kind: trigger.kind,
    cron: trigger.kind === "schedule" ? trigger.cron : null,
    run_at: trigger.kind === "once" ? trigger.at : null,
    timezone: clock?.timezone ?? null,
    catch_up: clock?.catch_up ?? true,
    signal:
      trigger.kind === "signal"
        ? {
            on: trigger.on,
            labels: trigger.labels,
            fire: trigger.fire,
            max_runs_per_hour: trigger.max_runs_per_hour,
          }
        : null,
    webhook:
      trigger.kind === "webhook"
        ? {
            fire: trigger.fire,
            max_runs_per_hour: trigger.max_runs_per_hour,
            url: webhookUrl(automationId),
            has_secret: hasWebhookSecret(automationId),
          }
        : null,
    slack_channel: slack?.channel ?? null,
    slack_match: slack?.match ?? null,
    slack_text: slack?.text ?? null,
  };
}

/** The wire shape carries the trigger flat; the host keeps it as a union. */
function toTrigger(
  input: AutomationInput,
  current?: Automation["trigger"],
): Automation["trigger"] {
  switch (input.trigger_kind) {
    case "schedule":
      return {
        kind: "schedule",
        cron: input.cron,
        timezone: input.timezone,
        catch_up: input.catch_up,
      };
    case "once":
      if (!input.run_at) {
        throw "A run-once automation needs a date and time.";
      }

      return {
        kind: "once",
        at: input.run_at,
        timezone: input.timezone,
        catch_up: input.catch_up,
      };
    case "manual":
      return { kind: "manual" };
    case "signal":
      return {
        kind: "signal",
        on: input.signal?.on ?? [],
        labels: input.signal?.labels ?? [],
        fire: input.signal?.fire ?? "each",
        max_runs_per_hour:
          input.signal?.max_runs_per_hour ?? DEFAULT_RUNS_PER_HOUR,
      };
    case "webhook":
      return {
        kind: "webhook",
        fire: input.webhook?.fire ?? "each",
        max_runs_per_hour:
          input.webhook?.max_runs_per_hour ?? DEFAULT_RUNS_PER_HOUR,
      };
    case "slack":
      if (!input.slack_channel) {
        throw "A Slack trigger needs a channel.";
      }

      // The wire has no fire mode or cap; keep what the Mac set.
      return slackTrigger({
        channel: input.slack_channel,
        match: input.slack_match ?? "any",
        text: input.slack_text ?? "",
        ...(current?.kind === "slack" && {
          fire: current.fire,
          max_runs_per_hour: current.max_runs_per_hour,
        }),
      });
  }
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

function remoteSetup(setup: RunnerSetup | undefined): RemoteRunner["setup"] {
  if (!setup) {
    return null;
  }

  return {
    install_command: setup.installCommand,
    install_url: setup.installUrl,
    login_command: setup.loginCommand,
  };
}

/** Runners an automation may be pinned to, for the phone's editor. */
export async function remoteRunners(): Promise<{ runners: RemoteRunner[] }> {
  const avail = await runnerAvailability();

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
      reported_models: lastKnownModels(runner.id).map((m) => ({
        value: m.value,
        displayName: m.displayName,
        description: m.description,
        supportsEffort: m.supportsEffort,
        supportedEffortLevels: m.supportedEffortLevels,
        supportsFastMode: m.supportsFastMode,
        resolvedModel: m.resolvedModel,
      })),
      supports_transcript_fork: runner.capabilities().supportsTranscriptFork,
      supports_side_question: runner.capabilities().supportsSideQuestion,
      available: avail.get(runner.id)?.available ?? true,
      unavailable_reason: avail.get(runner.id)?.unavailableReason ?? null,
      setup: remoteSetup(runner.setup?.()),
    })),
  };
}

export function createRemoteAutomation(input: AutomationInput): {
  automation: RemoteAutomation;
  detail: RemoteAutomationDetail;
} {
  return both(createAutomation(toCreateAutomationInput(input)));
}

export function toCreateAutomationInput(
  input: AutomationInput,
): CreateAutomationInput {
  return {
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
    claude_account_id: input.claude_account_id ?? null,
    report_slack_channel: input.report_slack_channel ?? null,
    precheck_command: input.precheck_command,
    precheck_timeout_seconds: input.precheck_timeout_seconds,
  };
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
    ...(patch.claude_account_id !== undefined && {
      claude_account_id: patch.claude_account_id ?? null,
    }),
    // Merged, so a guardrail an older phone doesn't know about survives its save.
    ...(patch.guardrails !== undefined && {
      guardrails: { ...current.guardrails, ...patch.guardrails },
    }),
    ...(patch.report_slack_channel !== undefined && {
      report_slack_channel: patch.report_slack_channel ?? null,
    }),
    ...(patch.precheck_command !== undefined && {
      precheck_command: patch.precheck_command,
    }),
    ...(patch.precheck_timeout_seconds !== undefined && {
      precheck_timeout_seconds: patch.precheck_timeout_seconds,
    }),
  };

  // The trigger is several wire fields; rebuild it from the current one so a
  // partial patch can change the cron without restating the timezone.
  const { trigger } = current;
  const clock =
    trigger.kind === "schedule" || trigger.kind === "once" ? trigger : null;
  const slack = trigger.kind === "slack" ? trigger : null;
  const touchesTrigger =
    patch.trigger_kind !== undefined ||
    patch.cron !== undefined ||
    patch.run_at !== undefined ||
    patch.timezone !== undefined ||
    patch.catch_up !== undefined ||
    patch.signal !== undefined ||
    patch.webhook !== undefined ||
    patch.slack_channel !== undefined ||
    patch.slack_match !== undefined ||
    patch.slack_text !== undefined;
  if (touchesTrigger) {
    update.trigger = toTrigger(
      {
        trigger_kind: patch.trigger_kind ?? trigger.kind,
        cron: patch.cron ?? (clock?.kind === "schedule" ? clock.cron : ""),
        run_at: patch.run_at ?? (clock?.kind === "once" ? clock.at : undefined),
        timezone: patch.timezone ?? clock?.timezone ?? "UTC",
        catch_up: patch.catch_up ?? clock?.catch_up ?? true,
        signal: patch.signal ?? wireTrigger(trigger, id).signal ?? undefined,
        webhook: patch.webhook ?? wireTrigger(trigger, id).webhook ?? undefined,
        slack_channel: patch.slack_channel ?? slack?.channel ?? null,
        slack_match: patch.slack_match ?? slack?.match ?? null,
        slack_text: patch.slack_text ?? slack?.text ?? null,
      } as AutomationInput,
      trigger,
    );
  }

  return both(updateAutomation(id, update));
}

export function rotateRemoteWebhook(id: string): {
  url: string | null;
  secret: string;
} {
  return rotateWebhookSecret(id);
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

/** Ad-hoc runs only, newest first, so a busy schedule can't push them out of the head. */
export function remoteScratchRuns(params: { limit?: number }): {
  runs: RemoteAutomationRun[];
} {
  const runs = listScratchRuns().slice(0, params.limit ?? DEFAULT_RUN_LIMIT);

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

/**
 * "Describe it" for a phone: the host drafts it, the phone's editor reviews it.
 * Flattened into the editor's shape with an empty id — nothing is saved.
 */
export async function remoteAutomationDraft(
  description: string,
  timezone?: string,
): Promise<{ automation: RemoteAutomationDetail; notes: string[] }> {
  const { input, notes } = await draftAutomation({ description, timezone });
  const { trigger } = input;

  return {
    automation: {
      id: "",
      name: input.name,
      description: input.description ?? "",
      enabled: input.enabled ?? false,
      ...wireTrigger(trigger, ""),
      repo_roots: input.scope?.repo_roots ?? [],
      source_ids: input.source_ids ?? [],
      playbook: input.playbook,
      extra_instructions: input.extra_instructions ?? "",
      autonomy: input.autonomy ?? null,
      model: input.model ?? null,
      runner: input.runner ?? null,
      claude_account_id: input.claude_account_id ?? null,
      guardrails: normalizeGuardrails(input.guardrails),
      precheck_command: input.precheck_command ?? "",
      precheck_timeout_seconds: normalizePrecheckTimeout(
        input.precheck_timeout_seconds,
      ),
    },
    notes,
  };
}
