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

import { emitHostEvent } from "@argus/host/bus";
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
      // Force a poll on resume — an explicit refresh signal, same semantics
      // as `emitCurrent()`. Skipping the agent gate here means a pause/resume
      // cycle always re-syncs stats even on agent-less sessions.
      this.poll(true);
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

      emitHostEvent(`session:diff-changed:${this.sessionId}`, stats);
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

/**
 * Compute combined diff stats for a session on demand (committed + working +
 * untracked). Used by the remote gateway to mirror the desktop sidebar's
 * green/red line counts. Returns zeros if the session isn't materialised.
 */
export async function computeSessionDiffStats(
  sessionId: string,
): Promise<DiffStats> {
  const ws = appState.sessions.get(sessionId);
  const worktreePath = ws?.path;
  if (!worktreePath) {
    return { additions: 0, deletions: 0, files: 0 };
  }
  const baseBranch =
    ws.kind !== "project_root" ? (ws.base_branch ?? null) : null;

  const [workingNumstat, untrackedRaw, committedNumstat] = await Promise.all([
    git(worktreePath, ["diff", "HEAD", "--numstat"]).catch(() => ""),
    git(worktreePath, ["ls-files", "--others", "--exclude-standard"]).catch(
      () => "",
    ),
    baseBranch
      ? git(worktreePath, ["diff", `${baseBranch}...HEAD`, "--numstat"]).catch(
          () => "",
        )
      : Promise.resolve(""),
  ]);

  const untrackedPaths = untrackedRaw.trim()
    ? untrackedRaw.trim().split("\n")
    : [];

  return combineDiffStats(committedNumstat, workingNumstat, untrackedPaths);
}

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
