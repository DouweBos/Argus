/** Persisted blueprints and the projects made from them, as versioned envelopes. */

import type { Blueprint, BlueprintRun } from "@argus/remote-protocol";
import { readEnvelope, writeJson } from "../automation/jsonFile";
import { blueprintRunsFilePath, blueprintsFilePath } from "./paths";

const SCHEMA_VERSION = 1;

/** Runs kept across every blueprint; older ones are dropped on write. */
export const MAX_BLUEPRINT_RUNS = 50;

export function loadBlueprints(): Blueprint[] {
  return readEnvelope<Blueprint>(
    blueprintsFilePath(),
    "blueprints.json",
    "blueprints",
    SCHEMA_VERSION,
  );
}

export function saveBlueprints(blueprints: Blueprint[]): void {
  writeJson(blueprintsFilePath(), { version: SCHEMA_VERSION, blueprints });
}

export function loadBlueprintRuns(): BlueprintRun[] {
  return readEnvelope<BlueprintRun>(
    blueprintRunsFilePath(),
    "blueprint-runs.json",
    "runs",
    SCHEMA_VERSION,
  );
}

/** Persist the newest {@link MAX_BLUEPRINT_RUNS} runs and return what was kept. */
export function saveBlueprintRuns(runs: BlueprintRun[]): BlueprintRun[] {
  const retained = runs
    .slice()
    .sort((a, b) => b.started_at - a.started_at)
    .slice(0, MAX_BLUEPRINT_RUNS);
  writeJson(blueprintRunsFilePath(), {
    version: SCHEMA_VERSION,
    runs: retained,
  });

  return retained;
}
