/**
 * Per-session FS watcher that emits `git_status_changed` IPC events when
 * any of the relevant `.git/...` files change.
 *
 * Watches a small allow-list (HEAD, index, refs/, MERGE_HEAD, REBASE_HEAD,
 * CHERRY_PICK_HEAD, packed-refs, FETCH_HEAD) and debounces emissions by
 * 100ms. Uses chokidar; falls back gracefully if `.git` is a worktree
 * pointer file (resolved via `git rev-parse --git-dir`).
 */

import chokidar, { type FSWatcher } from "chokidar";
import fs from "node:fs";
import path from "node:path";
import { emitHostEvent } from "@argus/host/bus";
import { warn } from "@argus/host/logger";
import { appState } from "../../state";
import { git } from "./git";

const DEBOUNCE_MS = 100;

interface GitWatcherHandle {
  stop: () => void;
}

/** Resolve real `.git` directory for a worktree (handles pointer files). */
export async function resolveGitDir(
  worktreePath: string,
): Promise<string | null> {
  const gitPath = path.join(worktreePath, ".git");
  try {
    const stat = fs.statSync(gitPath);
    if (stat.isDirectory()) {
      return gitPath;
    }
    if (stat.isFile()) {
      const content = fs.readFileSync(gitPath, "utf8").trim();
      if (content.startsWith("gitdir: ")) {
        const dir = content.slice("gitdir: ".length).trim();

        return path.isAbsolute(dir) ? dir : path.resolve(worktreePath, dir);
      }
    }
  } catch {
    // Fall through to git-rev-parse.
  }
  try {
    const out = await git(worktreePath, ["rev-parse", "--git-dir"]);
    const dir = out.trim();

    return path.isAbsolute(dir) ? dir : path.resolve(worktreePath, dir);
  } catch {
    return null;
  }
}

/**
 * Start a git watcher for a session. Returns a handle whose `stop()` must
 * be called when the session is removed.
 */
export async function startGitWatcher(
  sessionId: string,
  worktreePath: string,
): Promise<GitWatcherHandle> {
  const gitDir = await resolveGitDir(worktreePath);
  if (!gitDir) {
    warn(`gitWatcher: could not resolve .git for ${worktreePath}`);

    return { stop: () => {} };
  }

  const paths = [
    path.join(gitDir, "HEAD"),
    path.join(gitDir, "index"),
    path.join(gitDir, "refs"),
    path.join(gitDir, "packed-refs"),
    path.join(gitDir, "MERGE_HEAD"),
    path.join(gitDir, "REBASE_HEAD"),
    path.join(gitDir, "CHERRY_PICK_HEAD"),
    path.join(gitDir, "FETCH_HEAD"),
  ];

  let timer: ReturnType<typeof setTimeout> | null = null;
  const flush = () => {
    timer = null;
    emitHostEvent("git_status_changed", { sessionId });
  };
  const schedule = () => {
    if (timer) {
      clearTimeout(timer);
    }
    timer = setTimeout(flush, DEBOUNCE_MS);
  };

  let watcher: FSWatcher | null = null;
  try {
    watcher = chokidar.watch(paths, {
      ignoreInitial: true,
      persistent: true,
      // The `refs/` directory may not exist on a brand-new repo until a ref
      // is written; chokidar tolerates missing paths but we don't want it
      // to swallow legitimate errors elsewhere.
      ignorePermissionErrors: true,
      // Watch ref subdirectories recursively.
      depth: 99,
    });
    watcher.on("all", schedule);
    watcher.on("error", (err) => {
      warn(`gitWatcher(${sessionId}) error:`, err);
    });
  } catch (err) {
    warn(`gitWatcher(${sessionId}) failed to start:`, err);
  }

  return {
    stop: () => {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      if (watcher) {
        watcher.close().catch(() => {});
        watcher = null;
      }
    },
  };
}

/**
 * Tell every session of `sessionId`'s repo its status may have moved. A push,
 * pull or fetch rewrites remote-tracking refs in the common git dir, which a
 * linked worktree's watcher never sees, and every sibling's upstream with it.
 */
export function announceRepoGitStatus(sessionId: string): void {
  const repoRoot = appState.sessions.get(sessionId)?.repo_root;
  if (!repoRoot) {
    return;
  }
  for (const ws of appState.sessions.values()) {
    if (ws.repo_root === repoRoot) {
      emitHostEvent("git_status_changed", { sessionId: ws.id });
    }
  }
}

/** Runs a remote git operation, then announces the repo's status either way. */
export async function announcingRepoGitStatus<T>(
  sessionId: string,
  run: () => Promise<T>,
): Promise<T> {
  try {
    return await run();
  } finally {
    announceRepoGitStatus(sessionId);
  }
}

// ---------------------------------------------------------------------------
// Lifecycle helpers — keyed by sessionId so we don't leak watchers when a
// session is recreated under the same id.
// ---------------------------------------------------------------------------

const watchers = new Map<string, GitWatcherHandle>();

export async function attachGitWatcher(
  sessionId: string,
  worktreePath: string,
): Promise<void> {
  // Replace any existing watcher for this session.
  detachGitWatcher(sessionId);
  if (!worktreePath) {
    return;
  }
  const handle = await startGitWatcher(sessionId, worktreePath);
  watchers.set(sessionId, handle);
}

export function detachGitWatcher(sessionId: string): void {
  const existing = watchers.get(sessionId);
  if (existing) {
    existing.stop();
    watchers.delete(sessionId);
  }
}

/**
 * Best-effort: ensure every currently-known session has a git watcher
 * attached. Safe to call multiple times — `attachGitWatcher` deduplicates.
 */
export async function ensureGitWatchersForKnownSessions(): Promise<void> {
  for (const ws of appState.sessions.values()) {
    if (!ws.path || watchers.has(ws.id)) {
      continue;
    }
    try {
      await attachGitWatcher(ws.id, ws.path);
    } catch (err) {
      warn(`ensureGitWatchersForKnownSessions(${ws.id}) failed:`, err);
    }
  }
}

/** Stop all running git watchers (used during shutdown / repo-root removal). */
export function stopAllGitWatchers(): void {
  for (const [, handle] of watchers) {
    handle.stop();
  }
  watchers.clear();
}
