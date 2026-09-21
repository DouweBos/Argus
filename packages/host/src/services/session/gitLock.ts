/**
 * Per-worktree mutex around mutating git operations.
 *
 * The git CLI takes its own `.git/index.lock` for each invocation, but two
 * concurrent mutating operations (commit + pull, stash + commit, …) can
 * still interleave at the IPC layer and produce surprising states. This
 * module enforces serial execution per worktree-path: arriving operations
 * queue behind any in-flight op for the same worktree, so a user clicking
 * "Stage All" while a poll-driven status read finishes doesn't error out.
 *
 * If the queue stays busy for longer than `BUSY_TIMEOUT_MS` (something is
 * genuinely stuck), the new caller gives up with `GitError("busy")` so the
 * UI can surface a recoverable error rather than hang forever.
 *
 * Read-only IPC handlers (`git_log`, `git_status`, `git_show_commit`, …)
 * deliberately do NOT take the lock — they're idempotent and run with
 * `--no-optional-locks` so they don't contend on `.git/index.lock` either.
 */

import { GitError } from "./gitError";

const tails = new Map<string, Promise<unknown>>();

const BUSY_TIMEOUT_MS = 30_000;

/**
 * Run `fn` while holding the lock for `worktreePath`. If another mutating
 * operation is already in flight for the same worktree, queues behind it.
 * Throws `GitError("busy")` only if the wait exceeds `BUSY_TIMEOUT_MS`,
 * which indicates a genuinely stuck operation.
 */
export async function withGitLock<T>(
  worktreePath: string,
  fn: () => Promise<T>,
): Promise<T> {
  const previous = tails.get(worktreePath);

  let release!: () => void;
  const next = new Promise<void>((resolve) => {
    release = resolve;
  });
  tails.set(worktreePath, next);

  if (previous) {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        reject(
          new GitError(
            "busy",
            "Another git operation is in progress for this worktree",
          ),
        );
      }, BUSY_TIMEOUT_MS);
    });

    try {
      await Promise.race([previous.catch(() => undefined), timeout]);
    } catch (err) {
      // Timed out — drop our slot so we don't block future callers waiting
      // on a tail that nobody is going to release.
      if (tails.get(worktreePath) === next) {
        tails.delete(worktreePath);
      }
      release();
      throw err;
    } finally {
      if (timer) {
        clearTimeout(timer);
      }
    }
  }

  try {
    return await fn();
  } finally {
    if (tails.get(worktreePath) === next) {
      tails.delete(worktreePath);
    }
    release();
  }
}

/** Test helper — unused in production code paths. */
export function isLocked(worktreePath: string): boolean {
  return tails.has(worktreePath);
}
