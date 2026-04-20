/**
 * File system watcher for workspace directories.
 *
 * Polls both `git diff <base>...HEAD --numstat` (committed diff vs the base
 * branch) and `git diff HEAD --numstat` (working tree vs last commit, which
 * covers both staged and unstaged changes) so sidebar stats reflect the
 * **total** delta introduced by the workspace — not just uncommitted edits.
 * Plain `git diff --numstat` would only show unstaged vs index and would miss
 * fully staged files. Uses polling instead of recursive fs watches, which hit
 * macOS EMFILE limits on large monorepos (60K+ dirs).
 */

import fs from "node:fs";
import path from "node:path";
import { warn } from "../../../app/lib/logger";
import { getMainWindow } from "../../main";
import { appState } from "../../state";
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

  /** Re-emit current stats (for newly mounted listeners). */
  emitCurrent(): void {
    this.lastFingerprint = "";
    this.poll();
  }

  private async poll(): Promise<void> {
    if (this.paused) {
      return;
    }

    try {
      // Resolve base branch so we can include the committed diff (branch vs
      // base) alongside the working-tree diff. Workspaces without a base
      // branch (repo_root, brand-new branches) fall back to working tree only.
      const ws = appState.workspaces.get(this.workspaceId);
      const baseBranch =
        ws && ws.kind !== "repo_root" ? (ws.base_branch ?? null) : null;

      const [workingNumstat, untrackedRaw, committedNumstat] =
        await Promise.all([
          git(this.worktreePath, ["diff", "HEAD", "--numstat"]),
          git(this.worktreePath, [
            "ls-files",
            "--others",
            "--exclude-standard",
          ]),
          baseBranch
            ? git(this.worktreePath, [
                "diff",
                `${baseBranch}...HEAD`,
                "--numstat",
              ]).catch(() => "")
            : Promise.resolve(""),
        ]);

      const untrackedPaths = untrackedRaw.trim()
        ? untrackedRaw.trim().split("\n")
        : [];

      // Build a fingerprint to avoid emitting duplicate events.
      const fingerprint = `${committedNumstat}::${workingNumstat}::${untrackedPaths.length}`;
      if (fingerprint === this.lastFingerprint) {
        return;
      }
      this.lastFingerprint = fingerprint;

      const stats = combineDiffStats(
        committedNumstat,
        workingNumstat,
        untrackedPaths,
      );

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

/**
 * Parse one `git diff --numstat` output and fold each entry into `acc`.
 * Binary files (shown as `-\t-`) contribute 0 additions / 0 deletions but
 * still count as a changed file.
 */
function foldNumstat(
  numstatOutput: string,
  acc: { additions: number; deletions: number; paths: Set<string> },
): void {
  for (const line of numstatOutput.trim().split("\n")) {
    if (!line) {
      continue;
    }
    const parts = line.split("\t");
    if (parts.length < 3) {
      continue;
    }
    const added = parseInt(parts[0], 10);
    const removed = parseInt(parts[1], 10);
    // Path may itself contain tabs — join everything after the two counts.
    const filePath = parts.slice(2).join("\t");
    acc.paths.add(filePath);
    if (!Number.isNaN(added)) {
      acc.additions += added;
    }
    if (!Number.isNaN(removed)) {
      acc.deletions += removed;
    }
  }
}

/**
 * Combine the committed diff (branch vs base), the working-tree diff
 * (`git diff HEAD`), and any untracked files into a single `DiffStats`.
 *
 * Additions and deletions are summed across both diffs; the file count is the
 * deduped union of paths across all three sources.
 */
function combineDiffStats(
  committedNumstat: string,
  workingNumstat: string,
  untrackedPaths: string[],
): DiffStats {
  const acc = { additions: 0, deletions: 0, paths: new Set<string>() };
  foldNumstat(committedNumstat, acc);
  foldNumstat(workingNumstat, acc);
  for (const p of untrackedPaths) {
    acc.paths.add(p);
  }

  return {
    additions: acc.additions,
    deletions: acc.deletions,
    files: acc.paths.size,
  };
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
    // Repo-root workspaces have no base branch, so the committed-diff portion
    // is empty; stats are just the working-tree view.
    const numstat = await git(repoRoot, ["diff", "HEAD", "--numstat"]);
    const stats = combineDiffStats("", numstat, []);
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
    if (branch === previous) {
      return branch;
    }

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
    if (ws.kind !== "repo_root") {
      continue;
    }
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
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }
    this.fsWatcher?.close();
    this.fsWatcher = null;
  }

  /** Schedule a debounced refresh callback. */
  scheduleRefresh(cb: () => void): void {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }
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
      if (branch) {
        lastBranch = branch;
      }
    });
  });

  fsWatcher.on("error", (err) => {
    warn(`Branch watcher error for ${repoRoot}:`, err);
  });

  const handle = new BranchWatcherHandle(workspaceId, repoRoot, fsWatcher);
  // Also poll for diff changes (same as regular watchers).
  handle.start();

  return handle;
}
