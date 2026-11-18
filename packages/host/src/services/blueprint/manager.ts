/**
 * CRUD over blueprints and the record of projects made from them. Every write
 * goes through to disk and onto the host bus, so every client stays in step.
 */

import type {
  Blueprint,
  BlueprintRun,
  CreateBlueprintInput,
  UpdateBlueprintInput,
} from "@argus/remote-protocol";
import crypto from "node:crypto";
import { emitHostEvent } from "@argus/host/bus";
import { capture as telemetryCapture } from "../telemetry/telemetry";
import {
  loadBlueprintRuns,
  loadBlueprints,
  saveBlueprintRuns,
  saveBlueprints,
} from "./store";

let blueprints: Blueprint[] | null = null;
let runs: BlueprintRun[] | null = null;

function blueprintCache(): Blueprint[] {
  blueprints ??= loadBlueprints();

  return blueprints;
}

function runCache(): BlueprintRun[] {
  runs ??= loadBlueprintRuns();

  return runs;
}

/** Load both files once at boot. A run the host died during can't finish. */
export function initBlueprints(): void {
  blueprintCache();
  let changed = false;
  for (const run of runCache()) {
    if (run.status !== "running") {
      continue;
    }
    run.status = "failed";
    run.finished_at ??= Date.now();
    for (const step of run.steps) {
      if (step.status === "running") {
        step.status = "failed";
        step.error = "Argus quit before this step finished.";
      }
    }
    changed = true;
  }
  if (changed) {
    runs = saveBlueprintRuns(runCache());
  }
}

/** Test seam: drop the cache so the next read comes off disk again. */
export function resetBlueprintCache(): void {
  blueprints = null;
  runs = null;
}

export function listBlueprints(): Blueprint[] {
  return blueprintCache().map((b) => structuredClone(b));
}

export function getBlueprint(id: string): Blueprint | null {
  const found = blueprintCache().find((b) => b.id === id);

  return found ? structuredClone(found) : null;
}

export function requireBlueprint(id: string): Blueprint {
  const found = getBlueprint(id);
  if (!found) {
    throw `Blueprint not found: ${id}`;
  }

  return found;
}

/** An empty string clears the field: a partial patch can't carry a null. */
function normalize(blueprint: Blueprint): void {
  blueprint.name = blueprint.name.trim();
  blueprint.copy_project_settings_from =
    blueprint.copy_project_settings_from?.trim() || null;
}

function assertValid(blueprint: Blueprint): void {
  if (!blueprint.name.trim()) {
    throw "A blueprint needs a name.";
  }
  if (!blueprint.parent_dir.trim()) {
    throw "Choose the folder new projects go into.";
  }
  if (
    blueprint.scaffold.kind === "github_template" &&
    !/^[\w.-]+\/[\w.-]+$/.test(blueprint.scaffold.repo.trim())
  ) {
    throw "The template repository must look like owner/name.";
  }
  const copyFrom = blueprint.copy_project_settings_from;
  if (copyFrom && !blueprint.references.some((r) => r.path === copyFrom)) {
    throw "Project settings can only be copied from one of the references.";
  }
}

function emitBlueprints(): void {
  emitHostEvent("blueprints:changed", listBlueprints());
}

export function referenceCountBucket(count: number): "0" | "1" | "2-3" | "4+" {
  if (count <= 1) {
    return count <= 0 ? "0" : "1";
  }

  return count <= 3 ? "2-3" : "4+";
}

export function projectCountBucket(count: number): "1" | "2-3" | "4+" {
  if (count <= 1) {
    return "1";
  }

  return count <= 3 ? "2-3" : "4+";
}

export function createBlueprint(input: CreateBlueprintInput): Blueprint {
  const { from_draft: fromDraft, ...fields } = input;
  const now = Date.now();
  const blueprint: Blueprint = {
    ...fields,
    id: crypto.randomUUID(),
    name: fields.name.trim(),
    summary: fields.summary.trim(),
    github: { ...fields.github, owner: fields.github.owner.trim() },
    created_at: now,
    updated_at: now,
  };
  normalize(blueprint);
  assertValid(blueprint);
  blueprintCache().push(blueprint);
  saveBlueprints(blueprintCache());
  emitBlueprints();
  telemetryCapture("blueprint_edited", { action: "create" });
  if (fromDraft) {
    telemetryCapture("blueprint_drafted", {
      project_count_bucket: projectCountBucket(blueprint.references.length),
      saved: true,
      success: true,
    });
  }

  return structuredClone(blueprint);
}

export function updateBlueprint(
  id: string,
  patch: UpdateBlueprintInput,
): Blueprint {
  const list = blueprintCache();
  const index = list.findIndex((b) => b.id === id);
  if (index < 0) {
    throw `Blueprint not found: ${id}`;
  }
  const next: Blueprint = {
    ...list[index],
    ...Object.fromEntries(
      Object.entries(patch).filter(([, value]) => value !== undefined),
    ),
    id,
    created_at: list[index].created_at,
    updated_at: Date.now(),
  };
  normalize(next);
  assertValid(next);
  list[index] = next;
  saveBlueprints(list);
  emitBlueprints();
  telemetryCapture("blueprint_edited", { action: "update" });

  return structuredClone(next);
}

/** Projects already made from it keep their run records. */
export function deleteBlueprint(id: string): void {
  const list = blueprintCache();
  const index = list.findIndex((b) => b.id === id);
  if (index < 0) {
    throw `Blueprint not found: ${id}`;
  }
  list.splice(index, 1);
  saveBlueprints(list);
  emitBlueprints();
  telemetryCapture("blueprint_edited", { action: "delete" });
}

/** Newest first. */
export function listBlueprintRuns(blueprintId?: string): BlueprintRun[] {
  return runCache()
    .filter((run) => !blueprintId || run.blueprint_id === blueprintId)
    .sort((a, b) => b.started_at - a.started_at)
    .map((run) => structuredClone(run));
}

export function getBlueprintRun(id: string): BlueprintRun | null {
  const found = runCache().find((run) => run.id === id);

  return found ? structuredClone(found) : null;
}

/** Insert or replace a run, persist it and tell every client. */
export function saveBlueprintRun(run: BlueprintRun): BlueprintRun {
  const list = runCache().filter((r) => r.id !== run.id);
  list.push(structuredClone(run));
  runs = saveBlueprintRuns(list);
  emitHostEvent("blueprint_run:changed", structuredClone(run));

  return structuredClone(run);
}
