/**
 * Checkpoint service — snapshots a session's working tree before each user
 * prompt so the user can later restore the worktree to that exact state.
 *
 * A snapshot is a commit (parent HEAD) whose tree is the whole working tree,
 * untracked files included and ignored ones not, written through a scratch
 * index so the real one is untouched. Pinned under `refs/argus/checkpoints/<id>`
 * so it survives gc; the turn's end goes under `refs/argus/turn-ends/<id>`.
 *
 * Checkpoints complement (don't replace) `restoreAgentAtTurn`, which already
 * rewinds the conversation transcript: `restoreCheckpoint` rewinds the files,
 * and the frontend pairs the two when the user clicks "Restore" on a past
 * user message.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { appState } from "../../state";
import { git } from "../session/git";

const CHECKPOINT_REF_PREFIX = "refs/argus/checkpoints/";
const TURN_END_REF_PREFIX = "refs/argus/turn-ends/";
const SAFETY_REF_PREFIX = "refs/argus/safety/";

export interface Checkpoint {
  id: string;
  /** Commit SHA of the snapshot (HEAD when the tree was clean). */
  sha: string;
  /** True when there were uncommitted changes at snapshot time. */
  hasChanges: boolean;
  createdAt: number;
}

function refForCheckpoint(id: string): string {
  return `${CHECKPOINT_REF_PREFIX}${id}`;
}

export function refForTurnEnd(checkpointId: string): string {
  return `${TURN_END_REF_PREFIX}${checkpointId}`;
}

export function sessionWorktreePath(sessionId: string): string {
  const session = appState.sessions.get(sessionId);
  if (!session) {
    throw `No session found: ${sessionId}`;
  }
  if (session.kind !== "worktree" && session.kind !== "project_root") {
    throw `Cannot checkpoint session kind "${session.kind}"`;
  }

  return session.path;
}

export interface WorktreeSnapshot {
  sha: string;
  hasChanges: boolean;
}

/**
 * Commit the working tree as it stands. `git stash create` can't do this: it
 * takes no `-u` and leaves untracked files out. Clean trees answer HEAD.
 */
export async function snapshotWorktree(cwd: string): Promise<WorktreeSnapshot> {
  let head: string | null = null;
  try {
    head = (await git(cwd, ["rev-parse", "--verify", "HEAD^{commit}"])).trim();
  } catch {
    // Unborn branch: the snapshot has no parent.
  }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "argus-snapshot-"));
  const index = path.join(dir, "index");
  try {
    // Starting from the real index keeps `add -A` to a stat pass.
    const realIndex = path.resolve(
      cwd,
      (await git(cwd, ["rev-parse", "--git-path", "index"])).trim(),
    );
    if (fs.existsSync(realIndex)) {
      fs.copyFileSync(realIndex, index);
    }
    const env = { GIT_INDEX_FILE: index };
    await git(cwd, ["add", "-A", "--", "."], { env });
    const tree = (await git(cwd, ["write-tree"], { env })).trim();
    if (head) {
      const headTree = (await git(cwd, ["rev-parse", `${head}^{tree}`])).trim();
      if (headTree === tree) {
        return { sha: head, hasChanges: false };
      }
    }
    const parent = head ? ["-p", head] : [];
    const sha = (
      await git(cwd, ["commit-tree", tree, ...parent, "-m", "argus snapshot"], {
        env: {
          GIT_AUTHOR_NAME: "Argus",
          GIT_AUTHOR_EMAIL: "argus@localhost",
          GIT_COMMITTER_NAME: "Argus",
          GIT_COMMITTER_EMAIL: "argus@localhost",
        },
      })
    ).trim();

    return { sha, hasChanges: true };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

/** Capture the current working tree state as a checkpoint. */
export async function createCheckpoint(sessionId: string): Promise<Checkpoint> {
  const cwd = sessionWorktreePath(sessionId);
  const id = crypto.randomUUID();
  const { sha, hasChanges } = await snapshotWorktree(cwd);
  await git(cwd, ["update-ref", refForCheckpoint(id), sha]);

  return { id, sha, hasChanges, createdAt: Date.now() };
}

/** Pin the working tree as the end of the turn that started at `checkpointId`. */
export async function recordTurnEnd(
  sessionId: string,
  checkpointId: string,
): Promise<void> {
  const cwd = sessionWorktreePath(sessionId);
  const { sha } = await snapshotWorktree(cwd);
  await git(cwd, ["update-ref", refForTurnEnd(checkpointId), sha]);
}

/** The commit a checkpoint (or a turn end) ref points at; null once it's gone. */
export async function resolveCheckpointRef(
  cwd: string,
  ref: string,
): Promise<string | null> {
  try {
    return (
      await git(cwd, ["rev-parse", "--verify", `${ref}^{commit}`])
    ).trim();
  } catch {
    return null;
  }
}

export function checkpointRef(checkpointId: string): string {
  return refForCheckpoint(checkpointId);
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
 * Files that were untracked at snapshot time are in its tree, so step 1
 * tracks them and step 2 leaves them be. The session's HEAD is unchanged.
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
    const safety = await snapshotWorktree(cwd);
    if (safety.hasChanges) {
      const safetyRef = `${SAFETY_REF_PREFIX}${Date.now()}`;
      await git(cwd, ["update-ref", safetyRef, safety.sha]);
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
  try {
    await git(cwd, ["update-ref", "-d", refForTurnEnd(checkpointId)]);
  } catch {
    // A turn still running has no end yet.
  }
}
