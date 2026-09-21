/**
 * CRUD over automations and their runs, plus the in-memory cache both the
 * scheduler and the IPC layer read.
 *
 * Every mutation writes through to disk and emits on the host bus, so a
 * renderer, a paired Mac and the headless gateway all see the same state
 * without any of them polling.
 */

import type {
  Automation,
  AutomationRun,
  CreateAutomationInput,
  RunStatus,
  ScratchSpec,
  UpdateAutomationInput,
} from "./models";
import crypto from "node:crypto";
import fs from "node:fs";
import { emitHostEvent } from "@argus/host/bus";
import { info, warn } from "@argus/host/logger";
import { computeNextRun, isValidCron } from "./cron";
import { normalizeGuardrails } from "./guardrails";
import { disposeAutomationHostSession } from "./hostSession";
import { automationRunsDir } from "./paths";
import { deleteProposalsForAutomation } from "./proposals/manager";
import {
  applyRetention,
  loadAutomationRuns,
  loadAutomations,
  saveAutomationRuns,
  saveAutomations,
} from "./store";
import { playbookHash, refreshBuiltIns } from "./templateSync";
import { BUILT_IN_TEMPLATES } from "./templates";

let automations: Automation[] | null = null;
let runs: AutomationRun[] | null = null;

function automationCache(): Automation[] {
  if (!automations) {
    automations = loadAutomations();
    // Fields added after an automation was written stay absent on disk until
    // the next save, so fill them in on the way out of the file.
    for (const automation of automations) {
      automation.source_ids ??= [];
      automation.autonomy ??= null;
      automation.guardrails = normalizeGuardrails(automation.guardrails);
      automation.seeded_playbook_hash ??= null;
    }
    seedBuiltIns(automations);
  }

  return automations;
}

function runCache(): AutomationRun[] {
  if (!runs) {
    runs = loadAutomationRuns();
    // History written before reports were tracked is history you have already
    // lived through — it must not light the home screen up on first launch.
    for (const run of runs) {
      run.report_read ??= true;
    }
  }

  return runs;
}

/** Test seam: drop the cache so the next read comes off disk again. */
export function resetAutomationCache(): void {
  automations = null;
  runs = null;
}

function seedBuiltIns(list: Automation[]): void {
  let seeded = false;
  for (const [templateId, template] of Object.entries(BUILT_IN_TEMPLATES)) {
    if (list.some((a) => a.template_id === templateId)) {
      continue;
    }
    list.push(buildAutomation(template));
    seeded = true;
  }
  // A template whose playbook improved in this release reaches the copy on
  // disk here, but only while you have not edited it yourself.
  const refreshed = refreshBuiltIns(list);
  if (seeded || refreshed) {
    saveAutomations(list);
  }
}

function buildAutomation(input: CreateAutomationInput): Automation {
  const now = Date.now();
  const trigger = input.trigger;
  if (trigger.kind === "schedule" && !isValidCron(trigger.cron)) {
    throw `Invalid cron expression: ${trigger.cron}`;
  }

  const automation: Automation = {
    id: crypto.randomUUID(),
    name: input.name.trim(),
    description: input.description?.trim() ?? "",
    enabled: input.enabled ?? false,
    trigger,
    scope: { repo_roots: input.scope?.repo_roots ?? [] },
    source_ids: input.source_ids ?? [],
    playbook: input.playbook,
    autonomy: input.autonomy ?? null,
    guardrails: normalizeGuardrails(input.guardrails),
    model: input.model ?? null,
    template_id: input.template_id ?? null,
    // Only a built-in has a fingerprint to compare a future release against.
    seeded_playbook_hash: input.template_id
      ? playbookHash(input.playbook)
      : null,
    created_at: now,
    updated_at: now,
    last_run_at: null,
    next_run_at: null,
  };
  automation.next_run_at = nextRunFor(automation, now);

  return automation;
}

/** The next fire for an automation, or null when it has no clock. */
export function nextRunFor(
  automation: Automation,
  from: number,
): number | null {
  if (!automation.enabled || automation.trigger.kind !== "schedule") {
    return null;
  }

  try {
    return computeNextRun(
      automation.trigger.cron,
      automation.trigger.timezone,
      from,
    );
  } catch (e) {
    warn(`automation ${automation.id}: bad cron: ${String(e)}`);

    return null;
  }
}

function persistAutomations(): void {
  saveAutomations(automationCache());
  emitHostEvent("automations:changed", listAutomations());
}

function persistRun(run: AutomationRun): void {
  runs = saveAutomationRuns(runCache());
  emitHostEvent("automation_run:changed", { ...run });
}

/**
 * Load state and reconcile it with reality. A run marked `running` on disk
 * belongs to a process that died with the app, so it is failed rather than
 * left to block its automation's schedule forever.
 */
export function initAutomations(): void {
  automationCache();
  let interrupted = 0;
  for (const run of runCache()) {
    if (run.status !== "running" && run.status !== "queued") {
      continue;
    }
    run.status = "failed";
    run.finished_at = Date.now();
    run.error = "Argus quit while this run was in progress.";
    interrupted += 1;
  }
  if (interrupted > 0) {
    runs = saveAutomationRuns(runCache());
    info(`Marked ${interrupted} interrupted automation run(s) as failed`);
  }
}

// ---------------------------------------------------------------------------
// Automations
// ---------------------------------------------------------------------------

export function listAutomations(): Automation[] {
  return automationCache().map((a) => ({ ...a }));
}

export function getAutomation(id: string): Automation | null {
  const found = automationCache().find((a) => a.id === id);
  if (found) {
    return { ...found };
  }

  // An ad-hoc run is backed by no persisted automation, so its policy is
  // resolved from a synthetic one rebuilt from the run record. Doing it here
  // means the gate, the shell guard and the MCP guards all see an ad-hoc run
  // as exactly what it is — an automation with no autonomy of its own, which
  // therefore inherits the app default and is floored by the project ceiling.
  const scratchRun = runCache().find(
    (r) => r.automation_id === id && r.scratch !== null,
  );

  return scratchRun ? scratchAutomationForRun(scratchRun) : null;
}

/** The synthetic, never-persisted automation an ad-hoc run runs as. */
export function scratchAutomationForRun(run: AutomationRun): Automation | null {
  const spec = run.scratch;
  if (!spec) {
    return null;
  }

  return {
    id: run.automation_id,
    name: spec.name,
    description: "",
    enabled: false,
    trigger: { kind: "manual" },
    scope: { repo_roots: [...spec.scope.repo_roots] },
    source_ids: [...spec.source_ids],
    playbook: spec.playbook,
    // Never a level of its own: an ad-hoc run must not be a way to ask for a
    // higher rung than the app default allows.
    autonomy: null,
    guardrails: normalizeGuardrails(spec.guardrails),
    model: spec.model,
    template_id: null,
    seeded_playbook_hash: null,
    created_at: run.started_at,
    updated_at: run.started_at,
    last_run_at: run.started_at,
    next_run_at: null,
  };
}

export function requireAutomation(id: string): Automation {
  const found = automationCache().find((a) => a.id === id);
  if (!found) {
    throw `Automation not found: ${id}`;
  }

  return found;
}

export function createAutomation(input: CreateAutomationInput): Automation {
  if (!input.name.trim()) {
    throw "Automation name is required.";
  }
  if (!input.playbook.trim()) {
    throw "Automation playbook is required.";
  }

  const automation = buildAutomation(input);
  automationCache().push(automation);
  persistAutomations();
  info(`Created automation ${automation.id} (${automation.name})`);

  return { ...automation };
}

export function updateAutomation(
  id: string,
  patch: UpdateAutomationInput,
): Automation {
  const automation = requireAutomation(id);
  const trigger = patch.trigger ?? automation.trigger;
  if (trigger.kind === "schedule" && !isValidCron(trigger.cron)) {
    throw `Invalid cron expression: ${trigger.cron}`;
  }

  Object.assign(automation, patch, { trigger, updated_at: Date.now() });
  automation.guardrails = normalizeGuardrails(automation.guardrails);
  if (patch.next_run_at === undefined) {
    // The clock changed, or the switch did — either way the old fire is stale.
    automation.next_run_at = nextRunFor(automation, Date.now());
  }
  persistAutomations();

  return { ...automation };
}

export function setAutomationEnabled(id: string, enabled: boolean): Automation {
  return updateAutomation(id, { enabled });
}

export function deleteAutomation(id: string): void {
  const list = automationCache();
  const index = list.findIndex((a) => a.id === id);
  if (index === -1) {
    throw `Automation not found: ${id}`;
  }
  list.splice(index, 1);

  for (const run of runCache()) {
    if (run.automation_id === id && run.host_session_id) {
      disposeAutomationHostSession(run.host_session_id);
    }
  }
  runs = runCache().filter((r) => r.automation_id !== id);
  saveAutomationRuns(runs);
  deleteProposalsForAutomation(id);

  try {
    fs.rmSync(automationRunsDir(id), { force: true, recursive: true });
  } catch (e) {
    warn(`automation ${id}: could not remove run directories: ${String(e)}`);
  }

  persistAutomations();
  emitHostEvent("automation_run:changed", null);
}

/**
 * Record that an automation fired. The clock is not touched here — the
 * scheduler owns `next_run_at`, so a manual run never shifts a schedule.
 */
export function markAutomationFired(id: string, at: number): void {
  const automation = requireAutomation(id);
  automation.last_run_at = at;
  persistAutomations();
}

/** Recompute `next_run_at` without recording a fire. */
export function rescheduleAutomation(id: string, from: number): void {
  const automation = requireAutomation(id);
  automation.next_run_at = nextRunFor(automation, from);
  persistAutomations();
}

// ---------------------------------------------------------------------------
// Runs
// ---------------------------------------------------------------------------

/** Ad-hoc runs, newest first — the ones no automation backs. */
export function listScratchRuns(): AutomationRun[] {
  return runCache()
    .filter((r) => r.scratch !== null)
    .sort((a, b) => b.started_at - a.started_at)
    .map((r) => ({ ...r }));
}

export function listAutomationRuns(automationId?: string): AutomationRun[] {
  return runCache()
    .filter((r) => !automationId || r.automation_id === automationId)
    .sort((a, b) => b.started_at - a.started_at)
    .map((r) => ({ ...r }));
}

export function getAutomationRun(runId: string): AutomationRun | null {
  const found = runCache().find((r) => r.id === runId);

  return found ? { ...found } : null;
}

/** Whether this automation already has a run in flight. */
export function hasActiveRun(automationId: string): boolean {
  return runCache().some(
    (r) =>
      r.automation_id === automationId &&
      (r.status === "queued" || r.status === "running"),
  );
}

export function createRun(
  automationId: string,
  status: RunStatus,
  triggerReason: string,
  error: string | null = null,
  scratch: ScratchSpec | null = null,
): AutomationRun {
  const now = Date.now();
  const run: AutomationRun = {
    id: crypto.randomUUID(),
    automation_id: automationId,
    scratch,
    status,
    trigger_reason: triggerReason,
    started_at: now,
    finished_at: status === "queued" || status === "running" ? null : now,
    host_session_id: null,
    host_agent_id: null,
    cost_usd: null,
    report_markdown: null,
    report_blocks: null,
    error,
    report_read: false,
  };

  runCache().push(run);
  persistRun(run);

  return { ...run };
}

export function updateRun(
  runId: string,
  patch: Partial<Omit<AutomationRun, "automation_id" | "id">>,
): AutomationRun {
  const run = runCache().find((r) => r.id === runId);
  if (!run) {
    throw `Automation run not found: ${runId}`;
  }
  const hadReport = hasReport(run);
  Object.assign(run, patch);
  const superseded = hadReport || !hasReport(run) ? [] : supersedeReports(run);
  persistRun(run);
  for (const other of superseded) {
    emitHostEvent("automation_run:changed", { ...other });
  }

  return { ...run };
}

/** A report worth chasing: written, unread, and not yet replaced. */
export function hasUnreadReport(run: AutomationRun): boolean {
  return !run.report_read && hasReport(run);
}

function hasReport(run: AutomationRun): boolean {
  return (
    (run.report_blocks?.length ?? 0) > 0 || (run.report_markdown ?? "") !== ""
  );
}

/**
 * Only the newest report of an automation is worth chasing, so an earlier one
 * counts as read the moment it is replaced. Returns what changed, for the bus.
 *
 * Ad-hoc runs supersede nothing: they share a retention bucket but not an
 * identity, so one quick run must not retire an unrelated one's report.
 */
function supersedeReports(run: AutomationRun): AutomationRun[] {
  if (run.scratch) {
    return [];
  }
  const superseded: AutomationRun[] = [];
  for (const other of runCache()) {
    if (
      other.id === run.id ||
      other.scratch ||
      other.report_read ||
      other.started_at > run.started_at ||
      other.automation_id !== run.automation_id
    ) {
      continue;
    }
    other.report_read = true;
    superseded.push(other);
  }

  return superseded;
}

/** Mark a report as looked at. Idempotent — an already-read run emits nothing. */
export function markRunReportRead(runId: string): AutomationRun {
  const run = runCache().find((r) => r.id === runId);
  if (!run) {
    throw `Automation run not found: ${runId}`;
  }
  if (run.report_read) {
    return { ...run };
  }
  run.report_read = true;
  persistRun(run);

  return { ...run };
}

/** Retention applied on demand, e.g. after a bulk import. */
export function pruneRuns(): void {
  runs = applyRetention(runCache());
  saveAutomationRuns(runs);
}
