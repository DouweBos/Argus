/**
 * Merge and conflict detection between workspace branches.
 */

import { execFile } from "node:child_process";
import fs from "node:fs";
import { branchToDir, git, worktreesRoot } from "./git";

// ---------------------------------------------------------------------------
// check_merge_conflicts
// ---------------------------------------------------------------------------

/**
 * Returns a list of files that would conflict if `workspaceBranch` were merged
 * into `baseBranch`. Returns an empty array if no conflicts would occur.
 *
 * Uses `git merge-tree --write-tree` (git 2.38+). Parses the conflict info
 * section (stage entries) which is always present when conflicts exist,
 * regardless of whether informational CONFLICT messages are emitted.
 */
export async function checkMergeConflicts(
  repoRoot: string,
  workspaceBranch: string,
  baseBranch: string,
): Promise<string[]> {
  // Find the merge base.
  const mergeBase = (
    await git(repoRoot, ["merge-base", baseBranch, workspaceBranch])
  ).trim();

  if (!mergeBase) {
    throw "No common ancestor between branches";
  }

  // Use `git merge-tree` to detect conflicts without touching the working tree.
  // Note: exit code behavior varies across git versions — always parse stdout.
  const stdout: string = await new Promise((resolve) => {
    execFile(
      "git",
      ["merge-tree", "--write-tree", workspaceBranch, baseBranch],
      { cwd: repoRoot, maxBuffer: 32 * 1024 * 1024 },
      (_err: Error | null, out: string) => resolve(out || ""),
    );
  });

  const unique = [...new Set(parseConflictingFiles(stdout))].sort();

  return unique;
}

// ---------------------------------------------------------------------------
// merge_workspace_into_base
// ---------------------------------------------------------------------------

/**
 * Merge `workspaceBranch` into `baseBranch` using a temporary worktree.
 *
 * Commits any staged changes in the workspace before merging. Always cleans
 * up the temporary worktree even on failure.
 */
export async function mergeWorkspaceIntoBase(
  repoRoot: string,
  workspaceBranch: string,
  baseBranch: string,
): Promise<void> {
  // Commit any staged changes in the workspace worktree before merging.
  const wsPath = `${worktreesRoot(repoRoot)}/${branchToDir(workspaceBranch)}`;
  if (fs.existsSync(wsPath)) {
    try {
      // `diff --cached --quiet` exits non-zero when there are staged changes.
      await git(wsPath, ["diff", "--cached", "--quiet"]);
      // No staged changes — nothing to commit.
    } catch {
      // There are staged changes — commit them.
      await git(wsPath, ["commit", "-m", "Workspace changes"]);
    }
  }

  // Pre-check for conflicts.
  const conflicts = await checkMergeConflicts(
    repoRoot,
    workspaceBranch,
    baseBranch,
  );
  if (conflicts.length > 0) {
    throw `Cannot merge: ${conflicts.length} conflicting file(s):\n${conflicts.join("\n")}`;
  }

  // Create a temporary worktree for the base branch.
  const tempName = `_merge-staging-${crypto.randomUUID()}`;
  const tempPath = `${worktreesRoot(repoRoot)}/${tempName}`;

  let mergeError: unknown = null;

  try {
    fs.mkdirSync(worktreesRoot(repoRoot), { recursive: true });

    await git(repoRoot, ["worktree", "add", tempPath, baseBranch]);

    const mergeMsg = `Merge ${workspaceBranch} into ${baseBranch}`;
    await git(tempPath, ["merge", "--no-ff", workspaceBranch, "-m", mergeMsg]);
  } catch (e) {
    mergeError = e;
  } finally {
    // Always clean up the temp worktree.
    if (fs.existsSync(tempPath)) {
      try {
        await git(repoRoot, ["worktree", "remove", "--force", tempPath]);
      } catch {
        // If worktree remove failed, force-remove the directory.
        if (fs.existsSync(tempPath)) {
          fs.rmSync(tempPath, { recursive: true, force: true });
        }
      }
      try {
        await git(repoRoot, ["worktree", "prune"]);
      } catch {
        // Ignore prune failures.
      }
    }
  }

  if (mergeError !== null) {
    throw mergeError;
  }
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Parse conflicting file paths from `git merge-tree --write-tree` stdout.
 *
 * The output format is:
 *   <tree-oid>\n
 *   <mode> <hash> <stage>\t<path>\n   (one per stage per conflicted file,
 *                                      stage 1/2/3 = base/ours/theirs)
 *   ...
 *   \n
 *   <informational messages, e.g. "CONFLICT (content): Merge conflict in X">
 *
 * The stage entries are always present when conflicts exist, so we parse
 * those. We also parse `CONFLICT ... Merge conflict in <path>` messages as
 * a supplement (they cover non-content conflicts like modify/delete).
 */
export function parseConflictingFiles(stdout: string): string[] {
  const conflicts: string[] = [];
  const lines = stdout.split("\n");

  // The first non-empty line should be the tree OID. Skip it.
  let i = 0;
  while (i < lines.length && lines[i].trim() === "") {
    i++;
  }
  if (i < lines.length && /^[0-9a-f]{40,}$/.test(lines[i].trim())) {
    i++;
  } else {
    // No tree OID — nothing to parse.
    return [];
  }

  for (; i < lines.length; i++) {
    const line = lines[i];

    // Stage entry: "<mode> <hash> <stage>\t<path>" — stage 1/2/3 means conflict.
    const stageMatch = line.match(/^\d{6} [0-9a-f]+ ([1-3])\t(.+)$/);
    if (stageMatch) {
      conflicts.push(stageMatch[2]);
      continue;
    }

    // Informational "Merge conflict in <path>" messages.
    const trimmed = line.trim();
    if (trimmed.startsWith("CONFLICT")) {
      const lower = trimmed.toLowerCase();
      const idx = lower.lastIndexOf("merge conflict in ");
      if (idx !== -1) {
        const filePath = trimmed.slice(idx + "merge conflict in ".length).trim();
        if (filePath) {
          conflicts.push(filePath);
        }
      }
    }
  }

  return conflicts;
}
