/**
 * Conflict-resolution helpers (Phase 2 W9).
 *
 * Wraps `git merge|rebase|cherry-pick --continue|--abort|--skip` and
 * exposes per-file three-way reads (`git show :1:path` / `:2:path` / `:3:path`).
 *
 * All mutating ops are gated on `withGitLock` so they cannot race a
 * concurrent commit, pull, etc.
 */

import fs from "node:fs";
import path from "node:path";
import { appState } from "../../state";
import { git } from "./git";
import { withGitLock } from "./gitLock";

function sessionPath(id: string): string {
  const ws = appState.sessions.get(id);
  if (!ws) {
    throw `Session not found: ${id}`;
  }

  return ws.path;
}

// ---------------------------------------------------------------------------
// Merge / rebase / cherry-pick continue / abort / skip
// ---------------------------------------------------------------------------

export async function gitContinueMerge(id: string): Promise<void> {
  const wt = sessionPath(id);
  await withGitLock(wt, async () => {
    await git(wt, ["merge", "--continue"]);
  });
}

export async function gitAbortMerge(id: string): Promise<void> {
  const wt = sessionPath(id);
  await withGitLock(wt, async () => {
    await git(wt, ["merge", "--abort"]);
  });
}

export async function gitContinueRebase(id: string): Promise<void> {
  const wt = sessionPath(id);
  await withGitLock(wt, async () => {
    await git(wt, ["rebase", "--continue"]);
  });
}

export async function gitAbortRebase(id: string): Promise<void> {
  const wt = sessionPath(id);
  await withGitLock(wt, async () => {
    await git(wt, ["rebase", "--abort"]);
  });
}

export async function gitSkipRebase(id: string): Promise<void> {
  const wt = sessionPath(id);
  await withGitLock(wt, async () => {
    await git(wt, ["rebase", "--skip"]);
  });
}

export async function gitContinueCherryPick(id: string): Promise<void> {
  const wt = sessionPath(id);
  await withGitLock(wt, async () => {
    await git(wt, ["cherry-pick", "--continue"]);
  });
}

export async function gitAbortCherryPick(id: string): Promise<void> {
  const wt = sessionPath(id);
  await withGitLock(wt, async () => {
    await git(wt, ["cherry-pick", "--abort"]);
  });
}

// ---------------------------------------------------------------------------
// Per-file three-way read
// ---------------------------------------------------------------------------

export interface ConflictBlobs {
  ours: string;
  base: string;
  theirs: string;
  merged: string;
}

/** Read `:1:path` (base), `:2:` (ours), `:3:` (theirs), and the working-tree merged file. */
export async function gitGetConflict(
  id: string,
  filePath: string,
): Promise<ConflictBlobs> {
  const wt = sessionPath(id);

  const safeShow = async (stage: number): Promise<string> => {
    try {
      return await git(wt, ["show", `:${stage}:${filePath}`]);
    } catch {
      return "";
    }
  };

  const [base, ours, theirs] = await Promise.all([
    safeShow(1),
    safeShow(2),
    safeShow(3),
  ]);

  let merged = "";
  try {
    merged = fs.readFileSync(path.join(wt, filePath), "utf8");
  } catch {
    merged = "";
  }

  return { ours, base, theirs, merged };
}

/** Mark a conflicted file as resolved by adding it to the index. */
export async function gitMarkResolved(
  id: string,
  filePath: string,
): Promise<void> {
  const wt = sessionPath(id);
  await withGitLock(wt, async () => {
    await git(wt, ["add", "--", filePath]);
  });
}

/** Write the merged buffer back to the file. */
export async function gitWriteConflictMerged(
  id: string,
  filePath: string,
  contents: string,
): Promise<void> {
  const wt = sessionPath(id);
  const wtRoot = path.resolve(wt);
  const abs = path.resolve(wtRoot, filePath);
  const rel = path.relative(wtRoot, abs);
  if (rel.startsWith("..") || path.isAbsolute(rel)) {
    throw `Refusing to write outside session worktree: ${filePath}`;
  }
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, contents, "utf8");
}
