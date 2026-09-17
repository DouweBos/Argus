/**
 * Persisted automations and their run history.
 *
 * Two versioned JSON envelopes under `$ARGUS_HOME`. A schema mismatch renames
 * the file to `.bak` and starts fresh — automations are cheap to recreate and
 * a half-understood file is worse than none. Runs are capped per automation so
 * the history file cannot grow without bound.
 */

import type { Automation, AutomationRun } from "./models";
import fs from "node:fs";
import path from "node:path";
import { info, warn } from "@argus/host/logger";
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

function backup(filePath: string, label: string): void {
  try {
    fs.renameSync(filePath, `${filePath}.bak`);
    info(`${label} schema mismatch; backed up to ${filePath}.bak`);
  } catch (e) {
    warn(`Failed to back up ${label}: ${String(e)}`);
  }
}

function readEnvelope<T>(
  filePath: string,
  label: string,
  key: "automations" | "runs",
): T[] {
  let raw: string;
  try {
    raw = fs.readFileSync(filePath, "utf8");
  } catch {
    return [];
  }

  let file: Record<string, unknown>;
  try {
    file = JSON.parse(raw) as Record<string, unknown>;
  } catch (e) {
    warn(`Failed to parse ${label}:`, e);

    return [];
  }

  if (file.version !== SCHEMA_VERSION || !Array.isArray(file[key])) {
    backup(filePath, label);

    return [];
  }

  return file[key] as T[];
}

function writeJson(filePath: string, value: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tmp = `${filePath}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2), "utf8");
  fs.renameSync(tmp, filePath);
}

export function loadAutomations(): Automation[] {
  return readEnvelope<Automation>(
    automationsFilePath(),
    "automations.json",
    "automations",
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
