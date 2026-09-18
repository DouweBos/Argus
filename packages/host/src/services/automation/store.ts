/**
 * Persisted automations and their run history.
 *
 * Two versioned JSON envelopes under `$ARGUS_HOME` (see `jsonFile.ts`). Runs
 * are capped per automation so the history file cannot grow without bound.
 */

import type { Automation, AutomationRun } from "./models";
import { readEnvelope, writeJson } from "./jsonFile";
import { automationRunsFilePath, automationsFilePath } from "./paths";

const SCHEMA_VERSION = 1;

/** Runs retained per automation; older ones are dropped on write. */
export const MAX_RUNS_PER_AUTOMATION = 50;

interface AutomationsFile {
  version: number;
  automations: Automation[];
}

interface AutomationRunsFile {
  version: number;
  runs: AutomationRun[];
}

export function loadAutomations(): Automation[] {
  return readEnvelope<Automation>(
    automationsFilePath(),
    "automations.json",
    "automations",
    SCHEMA_VERSION,
  );
}

export function saveAutomations(automations: Automation[]): void {
  const file: AutomationsFile = { version: SCHEMA_VERSION, automations };
  writeJson(automationsFilePath(), file);
}

export function loadAutomationRuns(): AutomationRun[] {
  return readEnvelope<AutomationRun>(
    automationRunsFilePath(),
    "automation-runs.json",
    "runs",
    SCHEMA_VERSION,
  );
}

/**
 * Persist runs, keeping only the newest {@link MAX_RUNS_PER_AUTOMATION} per
 * automation. Returns the retained list so callers can keep their cache in
 * step with what is on disk.
 */
export function saveAutomationRuns(runs: AutomationRun[]): AutomationRun[] {
  const retained = applyRetention(runs);
  const file: AutomationRunsFile = { version: SCHEMA_VERSION, runs: retained };
  writeJson(automationRunsFilePath(), file);

  return retained;
}

/** Newest-first per automation, capped. Ordering across automations is kept. */
export function applyRetention(runs: AutomationRun[]): AutomationRun[] {
  const keep = new Set<string>();
  const byAutomation = new Map<string, AutomationRun[]>();

  for (const run of runs) {
    const list = byAutomation.get(run.automation_id) ?? [];
    list.push(run);
    byAutomation.set(run.automation_id, list);
  }

  for (const list of byAutomation.values()) {
    list
      .slice()
      .sort((a, b) => b.started_at - a.started_at)
      .slice(0, MAX_RUNS_PER_AUTOMATION)
      .forEach((run) => keep.add(run.id));
  }

  return runs.filter((run) => keep.has(run.id));
}
