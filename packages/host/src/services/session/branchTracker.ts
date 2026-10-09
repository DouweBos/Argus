/**
 * Keeps every session's `branch` current when its checkout moves outside
 * Argus (another git GUI, a terminal `git switch`, a rebase).
 *
 * Watches the checkout's own git dir — `.git/` for a repo root,
 * `.git/worktrees/<name>/` for a linked worktree — for `HEAD` and the
 * rebase/bisect markers, debounced, and on a change updates the session and
 * emits `session:updated` so every client refreshes without polling.
 */

import chokidar, { type FSWatcher } from "chokidar";
import fs from "node:fs";
import path from "node:path";
import { emitHostEvent } from "@argus/host/bus";
import { warn } from "@argus/host/logger";
import { appState } from "../../state";
import { loadArgusConfig } from "./argusConfig";
import { effectiveAutoFetchMinutes, reconfigureAutoFetch } from "./autoFetch";
import { resolveGitDir } from "./gitWatcher";
import {
  getMeta,
  loadMetadata,
  normalizeMetaKey,
  saveMetadata,
} from "./metadata";
import { computeSessionDiffStats } from "./watcher";

const DEBOUNCE_MS = 150;

/** Entries of a git dir that say which branch the checkout is on. */
const HEAD_ENTRIES = new Set([
  "HEAD",
  "rebase-merge",
  "rebase-apply",
  "BISECT_START",
]);

interface Tracker {
  path: string;
  watcher: FSWatcher | null;
  timer: ReturnType<typeof setTimeout> | null;
  stopped: boolean;
  /** Settles once the watcher is live (or failed to start). */
  ready: Promise<void>;
}

const trackers = new Map<string, Tracker>();

function readTrimmed(file: string): string | null {
  try {
    return fs.readFileSync(file, "utf8").trim();
  } catch {
    return null;
  }
}

function shortRef(ref: string): string {
  return ref.replace(/^refs\/heads\//, "");
}

/**
 * The branch a git dir's checkout is on, read straight from its files. A
 * rebase or bisect in progress detaches HEAD; the branch it started from is
 * still the one the user is on. Plain detached HEAD reads as `HEAD`, as
 * `git rev-parse --abbrev-ref HEAD` says.
 */
export function readCheckoutBranch(gitDir: string): string | null {
  const head = readTrimmed(path.join(gitDir, "HEAD"));
  if (head === null) {
    return null;
  }
  if (head.startsWith("ref: ")) {
    return shortRef(head.slice("ref: ".length).trim());
  }
  for (const dir of ["rebase-merge", "rebase-apply"]) {
    const name = readTrimmed(path.join(gitDir, dir, "head-name"));
    if (name?.startsWith("refs/")) {
      return shortRef(name);
    }
  }
  const bisect = readTrimmed(path.join(gitDir, "BISECT_START"));
  if (bisect && !/^[0-9a-f]{40,64}$/.test(bisect)) {
    return shortRef(bisect);
  }

  return "HEAD";
}

function persistBranch(repoRoot: string, sessionPath: string, branch: string) {
  try {
    const meta = loadMetadata(repoRoot);
    const entry = getMeta(meta, sessionPath);
    if (!entry || entry.branch === branch) {
      return;
    }
    meta.set(normalizeMetaKey(sessionPath), { ...entry, branch });
    saveMetadata(repoRoot, meta);
  } catch (e) {
    warn(`branchTracker: persist failed for ${sessionPath}:`, e);
  }
}

/**
 * Re-read a session's branch and, if it moved, update it and tell clients.
 * Returns the current branch, or null when it can't be read.
 */
export async function refreshSessionBranch(
  sessionId: string,
): Promise<string | null> {
  const ws = appState.sessions.get(sessionId);
  if (!ws?.path || ws.availability === "unavailable") {
    return null;
  }
  const gitDir = await resolveGitDir(ws.path);
  const branch = gitDir ? readCheckoutBranch(gitDir) : null;
  // The session may have gone while the git dir was resolved.
  const live = appState.sessions.get(sessionId);
  if (!branch || !live || branch === live.branch) {
    return branch;
  }

  live.branch = branch;
  persistBranch(live.repo_root, live.path, branch);
  emitHostEvent("session:updated", {
    id: sessionId,
    repo_root: live.repo_root,
    branch,
  });
  // Per-session channel the code and git views already follow.
  emitHostEvent(`session:branch-changed:${sessionId}`, { branch });

  if (live.kind === "project_root") {
    // Switching onto or off a protected branch starts or stops the
    // default-cadence fetch that keeps the trunk's ahead/behind current.
    try {
      const config = loadArgusConfig(live.repo_root);
      reconfigureAutoFetch(
        sessionId,
        live.repo_root,
        effectiveAutoFetchMinutes(
          live,
          config.auto_fetch_minutes,
          config.protected_branches,
        ),
      );
    } catch {
      // Config parse failure is non-fatal here.
    }
  }

  // The diff watcher only polls while an agent runs; a new branch is a new diff.
  computeSessionDiffStats(sessionId)
    .then((stats) => emitHostEvent(`session:diff-changed:${sessionId}`, stats))
    .catch(() => {});

  return branch;
}

/** Re-read every session's branch — a fallback for missed FS events. */
export async function refreshAllSessionBranches(): Promise<void> {
  for (const id of [...appState.sessions.keys()]) {
    await refreshSessionBranch(id);
  }
}

/**
 * Follow a session's checkout. Idempotent; a session whose path changed
 * (moved worktree) is re-watched at the new location.
 */
export function trackSessionBranch(sessionId: string): void {
  const ws = appState.sessions.get(sessionId);
  if (!ws?.path || ws.availability === "unavailable") {
    return;
  }
  const existing = trackers.get(sessionId);
  if (existing?.path === ws.path) {
    return;
  }
  untrackSessionBranch(sessionId);

  let markReady = () => {};
  const tracker: Tracker = {
    path: ws.path,
    watcher: null,
    timer: null,
    stopped: false,
    ready: new Promise<void>((resolve) => {
      markReady = resolve;
    }),
  };
  trackers.set(sessionId, tracker);

  const schedule = () => {
    if (tracker.timer) {
      clearTimeout(tracker.timer);
    }
    tracker.timer = setTimeout(() => {
      tracker.timer = null;
      refreshSessionBranch(sessionId).catch(() => {});
    }, DEBOUNCE_MS);
  };

  resolveGitDir(ws.path)
    .then((gitDir) => {
      if (!gitDir || tracker.stopped) {
        markReady();

        return;
      }
      // Watch the git dir itself: git replaces HEAD by renaming HEAD.lock over
      // it, which a watch on the file alone stops seeing after the first switch.
      const watcher = chokidar.watch(gitDir, {
        ignoreInitial: true,
        depth: 0,
        ignorePermissionErrors: true,
        ignored: (p: string) =>
          p !== gitDir &&
          path.dirname(p) === gitDir &&
          !HEAD_ENTRIES.has(path.basename(p)),
      });
      watcher.on("all", (_event, p) => {
        if (HEAD_ENTRIES.has(path.basename(p))) {
          schedule();
        }
      });
      watcher.on("error", (err) => {
        warn(`branchTracker(${sessionId}) error:`, err);
      });
      watcher.once("ready", markReady);
      tracker.watcher = watcher;
      // Catch a switch made while nothing was watching.
      schedule();
    })
    .catch((err: unknown) => {
      warn(`branchTracker(${sessionId}) failed to start:`, err);
      markReady();
    });
}

export function untrackSessionBranch(sessionId: string): void {
  const tracker = trackers.get(sessionId);
  if (!tracker) {
    return;
  }
  tracker.stopped = true;
  if (tracker.timer) {
    clearTimeout(tracker.timer);
  }
  tracker.watcher?.close().catch(() => {});
  trackers.delete(sessionId);
}

export function stopAllBranchTracking(): void {
  for (const id of [...trackers.keys()]) {
    untrackSessionBranch(id);
  }
}

/** Resolves once a session's watcher is live. For tests. */
export function branchTrackerReady(sessionId: string): Promise<void> {
  return trackers.get(sessionId)?.ready ?? Promise.resolve();
}
