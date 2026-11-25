/**
 * Clone Repository: a URL into a new project. The job comes back at once and
 * `project:clone` events carry its progress until it is a project, failed or
 * was cancelled (which also removes the partial folder).
 */

import type {
  CloneDefaults,
  CloneJob,
  ClonePreview,
  ClonePreviewInput,
  StartCloneInput,
} from "@argus/remote-protocol";
import { execFile } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { emitHostEvent } from "@argus/host/bus";
import { info } from "@argus/host/logger";
import { appState } from "../../state";
import { loadAppSettings, saveAppSettings } from "../appSettings/store";
import { expandHome } from "../blueprint/paths";
import { registerProject } from "../onboarding/state";
import { addRepoRoot } from "../session/manager";
import { capture as telemetryCapture } from "../telemetry/telemetry";
import { CLONE_CANCELLED, runClone } from "./run";
import {
  type CloneSourceSpec,
  cloneCommand,
  folderNameProblem,
  parseCloneSource,
} from "./url";

/** How many finished clones stay listed, for a client that reconnects. */
const KEEP_FINISHED = 10;
/** Progress events at most this often within a phase. */
const PROGRESS_INTERVAL_MS = 150;

interface Running {
  job: CloneJob;
  abort: AbortController;
}

const jobs = new Map<string, Running>();

function snapshot(job: CloneJob): CloneJob {
  return { ...job };
}

function emit(job: CloneJob): void {
  emitHostEvent("project:clone", snapshot(job));
}

export function listClones(): CloneJob[] {
  return [...jobs.values()]
    .map((r) => snapshot(r.job))
    .sort((a, b) => b.started_at - a.started_at);
}

let ghCache: { at: number; value: Promise<boolean> } | null = null;

/** Whether `gh` runs here; re-checked after a minute so installing it counts. */
export function ghAvailable(): Promise<boolean> {
  if (ghCache && Date.now() - ghCache.at < 60_000) {
    return ghCache.value;
  }
  const value = new Promise<boolean>((resolve) => {
    execFile("gh", ["--version"], { timeout: 5000 }, (err) => resolve(!err));
  });
  ghCache = { at: Date.now(), value };

  return value;
}

/** Test-only. */
export function resetCloneState(): void {
  jobs.clear();
  ghCache = null;
}

function projectParents(): string[] {
  const counts = new Map<string, number>();
  for (const root of appState.repoRoots) {
    const parent = path.dirname(root);
    counts.set(parent, (counts.get(parent) ?? 0) + 1);
  }

  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([dir]) => dir);
}

export async function cloneDefaults(): Promise<CloneDefaults> {
  const remembered = loadAppSettings().clone_parent_dir?.trim();
  const parents = projectParents();
  const parentDir = remembered
    ? expandHome(remembered)
    : (parents[0] ?? path.join(os.homedir(), "Developer"));

  return {
    parent_dir: parentDir,
    parents: [parentDir, ...parents.filter((p) => p !== parentDir)].slice(0, 8),
    gh_available: await ghAvailable(),
  };
}

interface Plan {
  source: CloneSourceSpec;
  name: string;
  parentDir: string;
  dest: string;
}

function plan(input: ClonePreviewInput): {
  plan: Plan | null;
  preview: ClonePreview;
} {
  let source: CloneSourceSpec | null = null;
  let problem: string | null = null;
  try {
    source = parseCloneSource(input.url);
  } catch (e) {
    problem = String(e);
  }
  const name = input.name?.trim() || source?.repoName || "";
  const parentDir = input.parent_dir.trim() ? expandHome(input.parent_dir) : "";
  const dest = parentDir && name ? path.join(parentDir, name) : "";

  if (!problem && !parentDir) {
    problem = "Choose a folder to clone into.";
  }
  if (!problem) {
    problem = folderNameProblem(name);
  }
  if (
    !problem &&
    fs.existsSync(parentDir) &&
    !fs.statSync(parentDir).isDirectory()
  ) {
    problem = `${parentDir} isn't a folder.`;
  }
  if (!problem && fs.existsSync(dest)) {
    problem = `${name} already exists in ${parentDir}.`;
  }
  if (
    !problem &&
    [...jobs.values()].some(
      (r) => r.job.status === "running" && r.job.path === dest,
    )
  ) {
    problem = `${name} is already being cloned there.`;
  }

  return {
    plan: source && !problem ? { source, name, parentDir, dest } : null,
    preview: { url_kind: source?.kind ?? null, name, path: dest, problem },
  };
}

export function previewClone(input: ClonePreviewInput): ClonePreview {
  return plan(input).preview;
}

function durationBucket(ms: number): "<1m" | "<5m" | "<10s" | ">=5m" {
  if (ms < 10_000) {
    return "<10s";
  }
  if (ms < 60_000) {
    return "<1m";
  }

  return ms < 300_000 ? "<5m" : ">=5m";
}

function prune(): void {
  const finished = listClones().filter((j) => j.status !== "running");
  for (const job of finished.slice(KEEP_FINISHED)) {
    jobs.delete(job.id);
  }
}

export async function startClone(input: StartCloneInput): Promise<CloneJob> {
  const planned = plan(input);
  if (!planned.plan) {
    throw planned.preview.problem ?? "That can't be cloned.";
  }
  const { source, parentDir, dest } = planned.plan;
  const gh = source.kind === "shorthand" && (await ghAvailable());
  fs.mkdirSync(parentDir, { recursive: true });

  const job: CloneJob = {
    id: crypto.randomUUID(),
    url: input.url.trim(),
    url_kind: source.kind,
    path: dest,
    status: "running",
    phase: "connecting",
    percent: null,
    error: null,
    started_at: Date.now(),
    finished_at: null,
  };
  const abort = new AbortController();
  jobs.set(job.id, { job, abort });
  prune();
  info(`Cloning ${source.kind} repository into ${dest}`);
  telemetryCapture("repository_clone_started", {
    source: input.source,
    url_kind: source.kind,
  });
  emit(job);

  let lastEmit = 0;
  runClone({
    ...cloneCommand(source, dest, { gh }),
    dest,
    cwd: parentDir,
    signal: abort.signal,
    onProgress: (p) => {
      const now = Date.now();
      const changed = p.phase !== job.phase;
      if (!changed && p.percent === job.percent) {
        return;
      }
      job.phase = p.phase;
      job.percent = p.percent;
      if (
        changed ||
        p.percent === 100 ||
        now - lastEmit >= PROGRESS_INTERVAL_MS
      ) {
        lastEmit = now;
        emit(job);
      }
    },
  })
    .then(() => {
      addRepoRoot(dest);
      registerProject(dest);
      saveAppSettings({ clone_parent_dir: parentDir });
      job.status = "done";
    })
    .catch((err: unknown) => {
      const cancelled = err === CLONE_CANCELLED;
      job.status = cancelled ? "cancelled" : "failed";
      job.error = cancelled ? null : String(err);
    })
    .finally(() => {
      job.finished_at = Date.now();
      telemetryCapture("repository_clone_finished", {
        source: input.source,
        url_kind: source.kind,
        success: job.status === "done",
        cancelled: job.status === "cancelled",
        duration_bucket: durationBucket(job.finished_at - job.started_at),
      });
      emit(job);
    });

  return snapshot(job);
}

/** Stops a running clone; false when there is none by that id. */
export function cancelClone(id: string): boolean {
  const running = jobs.get(id);
  if (!running || running.job.status !== "running") {
    return false;
  }
  running.abort.abort();

  return true;
}
