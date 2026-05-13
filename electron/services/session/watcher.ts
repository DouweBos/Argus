/**
 * File system watcher for session directories.
 *
 * Polls both `git diff <base>...HEAD --numstat` (committed diff vs the base
 * branch) and `git diff HEAD --numstat` (working tree vs last commit, which
 * covers both staged and unstaged changes) so sidebar stats reflect the
 * **total** delta introduced by the session — not just uncommitted edits.
 * Plain `git diff --numstat` would only show unstaged vs index and would miss
 * fully staged files. Uses polling instead of recursive fs watches, which hit
 * macOS EMFILE limits on large monorepos (60K+ dirs).
 */

import fs from "node:fs";
import path from "node:path";
import { warn } from "../../../app/lib/logger";
import { getMainWindow } from "../../main";
import { appState } from "../../state";
import { effectiveAutoFetchMinutes, reconfigureAutoFetch } from "./autoFetch";
import { git } from "./git";
import { loadArgusConfig } from "./setup";

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
  private sessionId: string;
  private worktreePath: string;
  private lastFingerprint = "";

  constructor(sessionId: string, worktreePath: string) {
    this.sessionId = sessionId;
    this.worktreePath = worktreePath;
  }

  /** Start polling at the given interval (ms). */
  start(intervalMs = 2000): void {
    // Fire immediately to seed initial stats; subsequent ticks gate on an
    // active agent (files don't change on their own).
    this.poll(true);
    this.timer = setInterval(() => this.poll(false), intervalMs);
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
    this.poll(true);
  }

  private hasActiveAgent(): boolean {
    for (const a of appState.agents.values()) {
      if (
        a.sessionId === this.sessionId &&
        !a.prewarmed &&
        a.status !== "stopped" &&
        a.status !== "error"
      ) {
        return true;
      }
    }

    return false;
  }

  private async poll(force = false): Promise<void> {
    if (this.paused) {
      return;
    }
    // Periodic ticks skip sessions with no active agent — files can't change
    // on their own, so re-running `git diff` just burns CPU. `force` is set
    // by `start()` and `emitCurrent()` so the sidebar still gets a one-shot
    // seed when a watcher first attaches.
    if (!force && !this.hasActiveAgent()) {
      return;
    }

    try {
      // Resolve base branch so we can include the committed diff (branch vs
      // base) alongside the working-tree diff. Sessions without a base
      // branch (repo_root, brand-new branches) fall back to working tree only.
      const ws = appState.sessions.get(this.sessionId);
      const baseBranch =
        ws && ws.kind !== "project_root" ? (ws.base_branch ?? null) : null;

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
        `session:diff-changed:${this.sessionId}`,
        stats,
      );
    } catch {
      // Git command failure is non-fatal (e.g. worktree deleted).
    }
  }
}

/** Start a file system watcher on a session directory. */
export function startWatcher(
  sessionId: string,
  worktreePath: string,
): WatcherHandle {
  const handle = new WatcherHandle(sessionId, worktreePath);
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

/** Emit branch-changed and diff-changed events for a session. */
async function emitBranchAndDiff(
  repoRoot: string,
  sessionId: string,
  branch: string,
): Promise<void> {
  getMainWindow()?.webContents.send(`session:branch-changed:${sessionId}`, {
    branch,
  });

  try {
    // Repo-root sessions have no base branch, so the committed-diff portion
    // is empty; stats are just the working-tree view.
    const numstat = await git(repoRoot, ["diff", "HEAD", "--numstat"]);
    const stats = combineDiffStats("", numstat, []);
    getMainWindow()?.webContents.send(
      `session:diff-changed:${sessionId}`,
      stats,
    );
  } catch {
    // Diff stat failure is non-fatal.
  }
}

/**
 * Read the current branch for a repo-root session and emit events if it
 * changed. Returns the branch name (or null on failure).
 */
export async function refreshBranchForSession(
  repoRoot: string,
  sessionId: string,
  lastKnownBranch?: string,
): Promise<string | null> {
  try {
    const branch = (
      await git(repoRoot, ["rev-parse", "--abbrev-ref", "HEAD"])
    ).trim();

    const previous =
      lastKnownBranch ?? appState.sessions.get(sessionId)?.branch;
    if (branch === previous) {
      return branch;
    }

    // Update in-memory state.
    const ws = appState.sessions.get(sessionId);
    if (ws) {
      ws.branch = branch;
      appState.sessions.set(sessionId, ws);
    }

    await emitBranchAndDiff(repoRoot, sessionId, branch);

    // Project_root branch swaps cross protected/non-protected boundaries —
    // re-apply the auto-fetch policy so a checkout of e.g. `main` starts the
    // default-cadence timer (and switching away stops it).
    if (ws?.kind === "project_root") {
      try {
        const config = loadArgusConfig(repoRoot);
        reconfigureAutoFetch(
          sessionId,
          repoRoot,
          effectiveAutoFetchMinutes(
            ws,
            config.auto_fetch_minutes,
            config.protected_branches,
          ),
        );
      } catch {
        // Config parse failure is non-fatal here.
      }
    }

    return branch;
  } catch {
    return null;
  }
}

/**
 * Refresh the branch for every repo-root session.
 *
 * Intended to be called on window focus as a fallback for cases where
 * `fs.watch` misses events (network drives, sleep/wake, etc.).
 */
export async function refreshAllBranches(): Promise<void> {
  for (const [id, ws] of appState.sessions.entries()) {
    if (ws.kind !== "project_root") {
      continue;
    }
    await refreshBranchForSession(ws.repo_root, id);
  }
}

/** Handle to a branch watcher backed by `fs.watch` on `.git/HEAD`. */
export class BranchWatcherHandle extends WatcherHandle {
  private fsWatcher: fs.FSWatcher | null = null;
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(sessionId: string, repoRoot: string, fsWatcher: fs.FSWatcher) {
    super(sessionId, repoRoot);
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
  sessionId: string,
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
      const branch = await refreshBranchForSession(
        repoRoot,
        sessionId,
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

  const handle = new BranchWatcherHandle(sessionId, repoRoot, fsWatcher);
  // Also poll for diff changes (same as regular watchers).
  handle.start();

  return handle;
}
