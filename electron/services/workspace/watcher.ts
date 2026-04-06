/**
 * File system watcher for workspace directories.
 *
 * Uses polling `git diff --numstat` on an interval rather than recursive
 * fs watches, which hit macOS EMFILE limits on large monorepos (60K+ dirs).
 */

import fs from "node:fs";
import path from "node:path";

import { appState } from "../../state";
import { getMainWindow } from "../../main";
import { git } from "./git";

/** Diff statistics emitted to the frontend. */
export interface DiffStats {
  additions: number;
  deletions: number;
  files: number;
}

/** Handle to a running file watcher. */
export class WatcherHandle {
  private timer: ReturnType<typeof setInterval> | null = null;
  private paused = false;
  private workspaceId: string;
  private worktreePath: string;
  private lastFingerprint = "";

  constructor(workspaceId: string, worktreePath: string) {
    this.workspaceId = workspaceId;
    this.worktreePath = worktreePath;
  }

  /** Start polling at the given interval (ms). */
  start(intervalMs = 2000): void {
    // Fire immediately, then poll.
    this.poll();
    this.timer = setInterval(() => this.poll(), intervalMs);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  pause(): void {
    this.paused = true;
  }

  resume(): void {
    if (this.paused) {
      this.paused = false;
      // Immediately check for changes that happened while paused.
      this.poll();
    }
  }

  private async poll(): Promise<void> {
    if (this.paused) return;

    try {
      // --numstat gives us a stable, parseable summary of changes.
      // Include untracked files via a second command.
      const [numstat, untrackedRaw] = await Promise.all([
        git(this.worktreePath, ["diff", "--numstat"]),
        git(this.worktreePath, ["ls-files", "--others", "--exclude-standard"]),
      ]);

      const untrackedCount = untrackedRaw.trim()
        ? untrackedRaw.trim().split("\n").length
        : 0;

      // Build a fingerprint to avoid emitting duplicate events.
      const fingerprint = `${numstat}::${untrackedCount}`;
      if (fingerprint === this.lastFingerprint) return;
      this.lastFingerprint = fingerprint;

      const stats = parseDiffStats(numstat);
      stats.files += untrackedCount;

      getMainWindow()?.webContents.send(
        `workspace:diff-changed:${this.workspaceId}`,
        stats,
      );
    } catch {
      // Git command failure is non-fatal (e.g. worktree deleted).
    }
  }
}

/** Start a file system watcher on a workspace directory. */
export function startWatcher(
  workspaceId: string,
  worktreePath: string,
): WatcherHandle {
  const handle = new WatcherHandle(workspaceId, worktreePath);
  handle.start();
  return handle;
}

// ---------------------------------------------------------------------------
// Branch watcher — monitors .git/HEAD for external branch switches
// ---------------------------------------------------------------------------

/** Parse `git diff --numstat` output into DiffStats. */
function parseDiffStats(numstatOutput: string): DiffStats {
  let files = 0;
  let additions = 0;
  let deletions = 0;

  for (const line of numstatOutput.trim().split("\n")) {
    if (!line) continue;
    const parts = line.split("\t");
    if (parts.length < 3) continue;
    // Binary files show "-" for additions/deletions.
    const added = parseInt(parts[0], 10);
    const removed = parseInt(parts[1], 10);
    files += 1;
    if (!Number.isNaN(added)) additions += added;
    if (!Number.isNaN(removed)) deletions += removed;
  }

  return { additions, deletions, files };
}

/** Emit branch-changed and diff-changed events for a workspace. */
async function emitBranchAndDiff(
  repoRoot: string,
  workspaceId: string,
  branch: string,
): Promise<void> {
  getMainWindow()?.webContents.send(`workspace:branch-changed:${workspaceId}`, {
    branch,
  });

  try {
    const numstat = await git(repoRoot, ["diff", "--numstat"]);
    const stats = parseDiffStats(numstat);
    getMainWindow()?.webContents.send(
      `workspace:diff-changed:${workspaceId}`,
      stats,
    );
  } catch {
    // Diff stat failure is non-fatal.
  }
}

/**
 * Read the current branch for a repo-root workspace and emit events if it
 * changed. Returns the branch name (or null on failure).
 */
export async function refreshBranchForWorkspace(
  repoRoot: string,
  workspaceId: string,
  lastKnownBranch?: string,
): Promise<string | null> {
  try {
    const branch = (
      await git(repoRoot, ["rev-parse", "--abbrev-ref", "HEAD"])
    ).trim();

    const previous =
      lastKnownBranch ?? appState.workspaces.get(workspaceId)?.branch;
    if (branch === previous) return branch;

    // Update in-memory state.
    const ws = appState.workspaces.get(workspaceId);
    if (ws) {
      ws.branch = branch;
      appState.workspaces.set(workspaceId, ws);
    }

    await emitBranchAndDiff(repoRoot, workspaceId, branch);
    return branch;
  } catch {
    return null;
  }
}

/**
 * Refresh the branch for every repo-root workspace.
 *
 * Intended to be called on window focus as a fallback for cases where
 * `fs.watch` misses events (network drives, sleep/wake, etc.).
 */
export async function refreshAllBranches(): Promise<void> {
  for (const [id, ws] of appState.workspaces.entries()) {
    if (ws.kind !== "repo_root") continue;
    await refreshBranchForWorkspace(ws.repo_root, id);
  }
}

/** Handle to a branch watcher backed by `fs.watch` on `.git/HEAD`. */
export class BranchWatcherHandle extends WatcherHandle {
  private fsWatcher: fs.FSWatcher | null = null;
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(workspaceId: string, repoRoot: string, fsWatcher: fs.FSWatcher) {
    super(workspaceId, repoRoot);
    this.fsWatcher = fsWatcher;
  }

  override stop(): void {
    super.stop();
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    this.fsWatcher?.close();
    this.fsWatcher = null;
  }

  /** Schedule a debounced refresh callback. */
  scheduleRefresh(cb: () => void): void {
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    this.debounceTimer = setTimeout(cb, 300);
  }
}

/**
 * Watch `.git/HEAD` for changes and emit branch/diff events when the branch
 * changes. Uses a single `fs.watch` on one file — no EMFILE risk.
 */
export function startBranchWatcher(
  repoRoot: string,
  workspaceId: string,
): BranchWatcherHandle {
  const gitHeadPath = path.join(repoRoot, ".git", "HEAD");
  let lastBranch: string | null = null;

  // Read initial branch (fire-and-forget).
  git(repoRoot, ["rev-parse", "--abbrev-ref", "HEAD"])
    .then((out) => {
      lastBranch = out.trim();
    })
    .catch(() => {});

  const fsWatcher = fs.watch(gitHeadPath, () => {
    handle.scheduleRefresh(async () => {
      const branch = await refreshBranchForWorkspace(
        repoRoot,
        workspaceId,
        lastBranch ?? undefined,
      );
      if (branch) lastBranch = branch;
    });
  });

  fsWatcher.on("error", (err) => {
    console.warn(`Branch watcher error for ${repoRoot}:`, err);
  });

  const handle = new BranchWatcherHandle(workspaceId, repoRoot, fsWatcher);
  // Also poll for diff changes (same as regular watchers).
  handle.start();
  return handle;
}
