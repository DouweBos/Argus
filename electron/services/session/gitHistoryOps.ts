/**
 * Reset / revert / cherry-pick (Phase 6B P12).
 *
 * - `gitReset` is project-only — running it on a session worktree would
 *   corrupt the agent's branch.
 * - `gitRevert` works on both scopes; revert creates a new commit and is safe.
 * - `gitCherryPick` is project-only — applying arbitrary commits onto an
 *   active session branch defeats the agent's isolation.
 */

import { appState } from "../../state";
import { git } from "./git";
import { GitError } from "./gitError";
import { withGitLock } from "./gitLock";

function requireSession(id: string) {
  const ws = appState.sessions.get(id);
  if (!ws) {
    throw new GitError("unknown", `Session not found: ${id}`);
  }

  return ws;
}

function requireProjectScope(id: string): { path: string } {
  const ws = requireSession(id);
  if (ws.kind !== "project_root") {
    throw new GitError(
      "unknown",
      "This operation is only available on the project root",
    );
  }

  return { path: ws.path };
}

export type ResetMode = "hard" | "mixed" | "soft";

export async function gitReset(
  id: string,
  opts: { ref: string; mode: ResetMode },
): Promise<void> {
  const { path } = requireProjectScope(id);
  await withGitLock(path, async () => {
    await git(path, ["reset", `--${opts.mode}`, opts.ref]);
  });
}

export async function gitRevert(
  id: string,
  opts: { hash: string; noCommit?: boolean },
): Promise<void> {
  const ws = requireSession(id);
  const args = ["revert"];
  if (opts.noCommit) {
    args.push("--no-commit");
  } else {
    args.push("--no-edit");
  }
  args.push(opts.hash);
  await withGitLock(ws.path, async () => {
    await git(ws.path, args);
  });
}

export async function gitCherryPick(
  id: string,
  opts: { hash: string[] | string; noCommit?: boolean },
): Promise<void> {
  const { path } = requireProjectScope(id);
  const hashes = Array.isArray(opts.hash) ? opts.hash : [opts.hash];
  if (hashes.length === 0) {
    throw new GitError("unknown", "No commits selected");
  }
  const args = ["cherry-pick"];
  if (opts.noCommit) {
    args.push("--no-commit");
  }
  args.push(...hashes);
  await withGitLock(path, async () => {
    await git(path, args);
  });
}
