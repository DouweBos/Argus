/**
 * Watches a session's worktree while a remote git runner has it open, so a
 * change nothing else broadcasts (an agent writing a file, a terminal commit)
 * still reaches the client as `git_status_changed`. One watch per session,
 * held by every connection that opened it and closed when the last one drops.
 */

import fs from "node:fs";
import path from "node:path";
import { emitHostEvent } from "@argus/host/bus";
import { warn } from "@argus/host/logger";
import {
  currentConnectionId,
  onConnectionClose,
} from "../remote/connectionScope";

export interface WatchedRepo {
  worktree: string;
  gitDir: string;
  commonGitDir: string;
}

/** Starts a recursive watch on `root`; returns its stop call. */
export type WatchRoot = (
  root: string,
  onChange: (file: string) => void,
  onError: (err: unknown) => void,
) => () => void;

/** Trailing quiet period before a burst of writes becomes one broadcast. */
export const DEBOUNCE_MS = 300;
/** A steady stream of writes still refreshes this often. */
export const MAX_WAIT_MS = 2000;
/** fs events for a runner call's index write can land just after it exits. */
export const RUN_QUIET_MS = 300;

/** What a worktree's own git dir holds that changes status, branches or history. */
const GIT_DIR_STATE = new Set([
  "HEAD",
  "index",
  "packed-refs",
  "refs",
  "MERGE_HEAD",
  "REBASE_HEAD",
  "CHERRY_PICK_HEAD",
  "REVERT_HEAD",
  "FETCH_HEAD",
  "rebase-merge",
  "rebase-apply",
  "sequencer",
]);
/** Shared by every worktree of the repo: branches and tags. */
const COMMON_DIR_STATE = new Set(["packed-refs", "refs"]);

interface SessionWatch {
  holders: Set<string>;
  stops: (() => void)[];
  /** Runner calls in flight; their index refreshes must not echo back. */
  running: number;
  quietUntil: number;
  timer: ReturnType<typeof setTimeout> | null;
  firstPendingAt: number;
}

const watches = new Map<string, SessionWatch>();

const fsWatchRoot: WatchRoot = (root, onChange, onError) => {
  const watcher = fs.watch(root, { recursive: true }, (_event, file) => {
    onChange(file ? path.join(root, file.toString()) : root);
  });
  watcher.on("error", onError);

  return () => watcher.close();
};

let watchRoot: WatchRoot = fsWatchRoot;

/** Swap the fs layer (tests). */
export function setWatchRootForTest(fn: WatchRoot | null): void {
  watchRoot = fn ?? fsWatchRoot;
}

function inside(parent: string, child: string): string | null {
  const rel = path.relative(parent, child);
  if (rel === "") {
    return "";
  }

  return rel.startsWith("..") || path.isAbsolute(rel) ? null : rel;
}

/**
 * Whether a change at `file` can move what the git views show. Sibling
 * worktrees' git dirs, objects and the runner's scratch space can't.
 */
export function isRelevantChange(repo: WatchedRepo, file: string): boolean {
  const firstSegment = (rel: string) => rel.split(path.sep)[0];
  const inGitDir = inside(repo.gitDir, file);
  if (inGitDir !== null) {
    return inGitDir === "" || GIT_DIR_STATE.has(firstSegment(inGitDir));
  }
  const inCommon = inside(repo.commonGitDir, file);
  if (inCommon !== null) {
    return COMMON_DIR_STATE.has(firstSegment(inCommon));
  }
  const inWorktree = inside(repo.worktree, file);

  return inWorktree !== null && firstSegment(inWorktree) !== ".git";
}

/** The fewest roots that cover the worktree and both git dirs. */
function watchRoots(repo: WatchedRepo): string[] {
  const roots: string[] = [];
  for (const dir of [repo.worktree, repo.commonGitDir, repo.gitDir]) {
    if (!roots.some((root) => inside(root, dir) !== null)) {
      roots.push(dir);
    }
  }

  return roots;
}

function flush(sessionId: string, watch: SessionWatch): void {
  watch.timer = null;
  watch.firstPendingAt = 0;
  if (watches.get(sessionId) === watch) {
    emitHostEvent("git_status_changed", { sessionId });
  }
}

/** The index alone: what a read-only `git status` rewrites as a side effect. */
export function isIndexWrite(repo: WatchedRepo, file: string): boolean {
  const rel = inside(repo.gitDir, file);

  return rel === "index" || rel === "index.lock";
}

function schedule(
  sessionId: string,
  watch: SessionWatch,
  indexOnly: boolean,
): void {
  const now = Date.now();
  if (indexOnly && (watch.running > 0 || now < watch.quietUntil)) {
    return;
  }
  if (watch.timer) {
    clearTimeout(watch.timer);
  } else {
    watch.firstPendingAt = now;
  }
  const wait = Math.min(
    DEBOUNCE_MS,
    Math.max(0, watch.firstPendingAt + MAX_WAIT_MS - now),
  );
  watch.timer = setTimeout(() => flush(sessionId, watch), wait);
}

function stop(sessionId: string, watch: SessionWatch): void {
  if (watch.timer) {
    clearTimeout(watch.timer);
  }
  for (const stopRoot of watch.stops) {
    try {
      stopRoot();
    } catch {
      // Already closed.
    }
  }
  if (watches.get(sessionId) === watch) {
    watches.delete(sessionId);
  }
}

function start(sessionId: string, repo: WatchedRepo): SessionWatch {
  const watch: SessionWatch = {
    holders: new Set(),
    stops: [],
    running: 0,
    quietUntil: 0,
    timer: null,
    firstPendingAt: 0,
  };
  const onChange = (file: string) => {
    if (isRelevantChange(repo, file)) {
      schedule(sessionId, watch, isIndexWrite(repo, file));
    }
  };
  const onError = (err: unknown) => {
    warn(`gitRunner watch(${sessionId}) error:`, err);
  };
  for (const root of watchRoots(repo)) {
    try {
      watch.stops.push(watchRoot(root, onChange, onError));
    } catch (err) {
      warn(`gitRunner watch(${sessionId}) failed on ${root}:`, err);
    }
  }

  return watch;
}

/**
 * Keep `sessionId` watched for the current connection until it closes. A
 * no-op outside a connection: local callers already get the host's own events.
 */
export function holdRepoWatch(sessionId: string, repo: WatchedRepo): void {
  const connectionId = currentConnectionId();
  if (!connectionId) {
    return;
  }
  let watch = watches.get(sessionId);
  if (!watch) {
    watch = start(sessionId, repo);
    watches.set(sessionId, watch);
  }
  if (watch.holders.has(connectionId)) {
    return;
  }
  watch.holders.add(connectionId);
  const held = watch;
  onConnectionClose(() => {
    held.holders.delete(connectionId);
    if (held.holders.size === 0) {
      stop(sessionId, held);
    }
  });
}

/**
 * Mark a runner call in flight for `sessionId`; the returned call ends it.
 * An index refresh from its `git status` would otherwise bounce back as a
 * change and refresh the client into another `git status`, forever.
 */
export function beginRunnerRun(sessionId: string): () => void {
  const watch = watches.get(sessionId);
  if (!watch) {
    return () => undefined;
  }
  watch.running += 1;

  return () => {
    watch.running -= 1;
    watch.quietUntil = Date.now() + RUN_QUIET_MS;
  };
}

/** Sessions watched right now and by how many connections (tests). */
export function watchedSessions(): Map<string, number> {
  return new Map([...watches].map(([id, w]) => [id, w.holders.size]));
}
