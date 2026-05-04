/**
 * Checkpoint service — snapshots a session's working tree before each user
 * prompt so the user can later restore the worktree to that exact state.
 *
 * Snapshots use `git stash create -u`, which builds a commit object capturing
 * tracked + staged + untracked file contents without touching HEAD or the
 * index. We pin those commits under `refs/argus/checkpoints/<id>` so they
 * survive git's gc.
 *
 * Checkpoints complement (don't replace) `restoreAgentAtTurn`, which already
 * rewinds the conversation transcript: `restoreCheckpoint` rewinds the files,
 * and the frontend pairs the two when the user clicks "Restore" on a past
 * user message.
 */

import { appState } from "../../state";
import { git } from "../session/git";

const CHECKPOINT_REF_PREFIX = "refs/argus/checkpoints/";
const SAFETY_REF_PREFIX = "refs/argus/safety/";

export interface Checkpoint {
  id: string;
  /** Commit SHA of the snapshot (stash-style commit, or HEAD when clean). */
  sha: string;
  /** True when there were uncommitted changes at snapshot time. */
  hasChanges: boolean;
  createdAt: number;
}

function refForCheckpoint(id: string): string {
  return `${CHECKPOINT_REF_PREFIX}${id}`;
}

function sessionWorktreePath(sessionId: string): string {
  const session = appState.sessions.get(sessionId);
  if (!session) {
    throw `No session found: ${sessionId}`;
  }
  if (session.kind !== "worktree" && session.kind !== "project_root") {
    throw `Cannot checkpoint session kind "${session.kind}"`;
  }

  return session.path;
}

/**
 * Capture the current working tree state as a checkpoint.
 *
 * `git stash create -u` returns a commit SHA with tree = working tree (tracked
 * + untracked merged), parents = [HEAD, index, untracked]. When the tree is
 * clean it returns nothing; we fall back to the HEAD SHA so a checkpoint
 * always has a usable sha.
 */
export async function createCheckpoint(sessionId: string): Promise<Checkpoint> {
  const cwd = sessionWorktreePath(sessionId);
  const id = crypto.randomUUID();

  let sha: string;
  let hasChanges: boolean;
  const stashOut = (await git(cwd, ["stash", "create", "-u"])).trim();
  if (stashOut.length > 0) {
    sha = stashOut;
    hasChanges = true;
  } else {
    sha = (await git(cwd, ["rev-parse", "HEAD"])).trim();
    hasChanges = false;
  }

  // Pin the commit so it isn't gc'd.
  await git(cwd, ["update-ref", refForCheckpoint(id), sha]);

  return { id, sha, hasChanges, createdAt: Date.now() };
}

/**
 * Restore a session's working tree to a previously created checkpoint.
 *
 * Before applying we save the current state under `refs/argus/safety/<ts>`
 * so a misclick can be recovered manually with git plumbing.
 *
 * Strategy:
 *   1. `read-tree --reset -u <tree>` — rewrites the index to the snapshot
 *      tree and updates the working tree for tracked files. Files removed
 *      between snapshot and now are restored; files modified are reverted.
 *   2. `clean -fd` — removes any files that were added after the snapshot
 *      (they're now untracked because they aren't in the new index).
 *
 * Files that were untracked at snapshot time get tracked in the new index
 * by step 1, so step 2 won't delete them. The session's HEAD is unchanged.
 */
export async function restoreCheckpoint(
  sessionId: string,
  checkpointId: string,
): Promise<void> {
  const cwd = sessionWorktreePath(sessionId);
  const ref = refForCheckpoint(checkpointId);

  // Resolve the checkpoint ref — fail loudly if it's gone.
  let sha: string;
  try {
    sha = (await git(cwd, ["rev-parse", "--verify", `${ref}^{commit}`])).trim();
  } catch {
    throw `Checkpoint not found: ${checkpointId}`;
  }

  // Capture a safety snapshot of the current state.
  try {
    const safetySha = (await git(cwd, ["stash", "create", "-u"])).trim();
    if (safetySha.length > 0) {
      const safetyRef = `${SAFETY_REF_PREFIX}${Date.now()}`;
      await git(cwd, ["update-ref", safetyRef, safetySha]);
    }
  } catch {
    // Safety ref is best-effort — don't block the restore on it.
  }

  // Apply the checkpoint tree.
  await git(cwd, ["read-tree", "--reset", "-u", `${sha}^{tree}`]);
  await git(cwd, ["clean", "-fd"]);
}

/**
 * Drop a checkpoint ref. Best-effort — missing refs are not an error.
 */
export async function deleteCheckpoint(
  sessionId: string,
  checkpointId: string,
): Promise<void> {
  const cwd = sessionWorktreePath(sessionId);
  try {
    await git(cwd, ["update-ref", "-d", refForCheckpoint(checkpointId)]);
  } catch {
    // Ref may already be gone.
  }
}
