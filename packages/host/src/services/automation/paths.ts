/**
 * On-disk locations for automation state, all under `$ARGUS_HOME` so a
 * headless server (which uses `~/.argus-server`) never collides with a desktop
 * on the same machine.
 */

import path from "node:path";
import { argusHomeDir } from "../../lib/argusHome";

export function automationsFilePath(): string {
  return path.join(argusHomeDir(), "automations.json");
}

export function automationRunsFilePath(): string {
  return path.join(argusHomeDir(), "automation-runs.json");
}

/** Neutral working directory for one run's host agent. Not a git repo. */
export function automationRunDir(automationId: string, runId: string): string {
  return path.join(argusHomeDir(), "automation-runs", automationId, runId);
}

/** Every run directory belonging to one automation. */
export function automationRunsDir(automationId: string): string {
  return path.join(argusHomeDir(), "automation-runs", automationId);
}
