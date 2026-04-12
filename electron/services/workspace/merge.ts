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
 * Uses `git merge-tree --write-tree` (git 2.38+) with a fallback to the
 * legacy three-way `git merge-tree` for older git versions.
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
  const conflicts: string[] = await new Promise((resolve) => {
    execFile(
      "git",
      [
        "merge-tree",
        "--write-tree",
        "--no-messages",
        workspaceBranch,
        baseBranch,
      ],
      { cwd: repoRoot },
      async (err: Error | null, stdout: string) => {
        if (!err) {
          // Exit code 0 = clean merge.
          resolve([]);

          return;
        }

        // Exit code 1 = conflicts. Parse conflicting file paths.
        const parsed = parseConflictingFiles(stdout);

        if (parsed.length > 0) {
          resolve(parsed);

          return;
        }

        // Fallback: legacy `git merge-tree <base> <b1> <b2>`.
        let legacy = "";
        try {
          legacy = await git(repoRoot, [
            "merge-tree",
            mergeBase,
            baseBranch,
            workspaceBranch,
          ]);
        } catch {
          // Ignore errors in the fallback.
        }

        const legacyConflicts: string[] = [];
        for (const line of legacy.split("\n")) {
          if (line.startsWith("+<<<<<<<") || line.includes("changed in both")) {
            const rest = line.replace(/^changed in both/, "");
            const filePath = rest.replace(/^:+/, "").trim();
            if (filePath) {
              legacyConflicts.push(filePath);
            }
          }
        }

        if (legacyConflicts.length > 0) {
          resolve(legacyConflicts);
        } else {
          // Could not determine specific files but there are conflicts.
          resolve(["(unable to determine specific conflicting files)"]);
        }
      },
    );
  });

  const unique = [...new Set(conflicts)].sort();

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
 * Lines of the form `CONFLICT (...): Merge conflict in <path>` are extracted.
 */
export function parseConflictingFiles(stdout: string): string[] {
  const conflicts: string[] = [];
  let inInformational = false;

  for (const line of stdout.split("\n")) {
    // Skip the first line (tree hash — 40 hex chars).
    if (!inInformational && /^[0-9a-f]{40}$/.test(line.trim())) {
      inInformational = true;
      continue;
    }
    if (!inInformational) {
      continue;
    }

    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }

    if (trimmed.startsWith("CONFLICT")) {
      const rest = trimmed.slice("CONFLICT".length);
      const marker1 = "Merge conflict in ";
      const marker2 = "merge conflict in ";
      const idx1 = rest.lastIndexOf(marker1);
      const idx2 = rest.lastIndexOf(marker2);
      if (idx1 !== -1) {
        const filePath = rest.slice(idx1 + marker1.length).trim();
        if (filePath) {
          conflicts.push(filePath);
        }
      } else if (idx2 !== -1) {
        const filePath = rest.slice(idx2 + marker2.length).trim();
        if (filePath) {
          conflicts.push(filePath);
        }
      }
    }
  }

  return conflicts;
}
