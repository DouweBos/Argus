/**
 * Low-level git CLI utilities and worktree directory helpers.
 */

import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { warn } from "../../../app/lib/logger";

const execFileAsync = promisify(execFile);

// ---------------------------------------------------------------------------
// Worktree directory helpers
// ---------------------------------------------------------------------------

/**
 * Compute the root directory that holds all worktrees for a given repo.
 *
 * ```
 * repo  = /home/user/Projects/MyApp
 * roots = /home/user/.argus/worktrees/MyApp-argus-worktrees
 * ```
 */
export function worktreesRoot(repoRoot: string): string {
  const name = path.basename(repoRoot) || "repo";

  return path.join(
    os.homedir(),
    ".argus",
    "worktrees",
    `${name}-argus-worktrees`,
  );
}

/**
 * Sanitise a branch name so it is safe to use as a directory component.
 * Replaces characters that are invalid in path components with underscores.
 */
export function branchToDir(branch: string): string {
  return branch.replace(/[/\\:*?"<>| ]/g, "_");
}

/**
 * Convert a workspace title to a valid git branch name (slug).
 *
 * Git branch names cannot contain spaces or characters like ~ ^ : ? * [ \.
 * Produces a lowercase, hyphen-separated slug suitable for `git worktree add -b`.
 */
export function titleToBranchSlug(title: string): string {
  const mapped = title
    .trim()
    .split("")
    .map((c) => {
      if (c === " " || c === "\t") {
        return "-";
      }
      if (
        c === "~" ||
        c === "^" ||
        c === ":" ||
        c === "?" ||
        c === "*" ||
        c === "[" ||
        c === "\\" ||
        c === "@" ||
        c === "{" ||
        c === '"' ||
        c === "<" ||
        c === ">" ||
        c === "|"
      ) {
        return "_";
      }
      if (/[a-zA-Z0-9\-_/]/.test(c)) {
        return c;
      }

      return "-";
    })
    .join("");

  // Collapse multiple hyphens/underscores, trim from ends, lowercase.
  const parts = mapped.split(/[-_]+/).filter((s) => s.length > 0);
  const slug = parts
    .join("-")
    .replace(/^[-_]+|[-_]+$/g, "")
    .replace(/^-+/, "")
    .toLowerCase();

  return slug.length === 0 ? "workspace" : slug;
}

// ---------------------------------------------------------------------------
// Git helpers (shell out to `git`)
// ---------------------------------------------------------------------------

/**
 * Run a `git` command in `cwd`, capturing stdout + stderr.
 *
 * Returns stdout on success; throws a descriptive string on non-zero exit.
 */
export async function git(cwd: string, args: string[]): Promise<string> {
  try {
    const { stdout } = await execFileAsync("git", args, { cwd });

    return stdout;
  } catch (err: unknown) {
    // execFile rejects with an object that has stdout/stderr when the process
    // exits with a non-zero code.
    const e = err as { stdout?: string; stderr?: string; message?: string };
    const stdout = e.stdout ?? "";
    const stderr = e.stderr ?? "";
    throw `git ${args.join(" ")} failed:\nstdout: ${stdout}\nstderr: ${stderr}`;
  }
}

// ---------------------------------------------------------------------------
// Repair orphaned worktrees
// ---------------------------------------------------------------------------

/**
 * Scan the managed worktrees directory for directories that exist on disk
 * (with a valid `.git` file) but are not registered with git. Re-register
 * them using `git worktree repair`.
 *
 * This handles the case where `git worktree prune` (or a failed delete)
 * removed git's back-reference but left the directory intact.
 */
export async function repairOrphanedWorktrees(repoRoot: string): Promise<void> {
  const root = worktreesRoot(repoRoot);
  if (!fs.existsSync(root)) {
    return;
  }

  // Collect paths that git currently knows about.
  let knownRaw: string;
  try {
    knownRaw = await git(repoRoot, ["worktree", "list", "--porcelain"]);
  } catch {
    return;
  }

  const known = new Set<string>(
    knownRaw
      .split("\n")
      .filter((line) => line.startsWith("worktree "))
      .map((line) => line.slice("worktree ".length).trim()),
  );

  // Scan managed directory for orphans.
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(root, { withFileTypes: true });
  } catch {
    return;
  }

  const orphanPaths: string[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }
    const dirPath = path.join(root, entry.name);
    const gitFile = path.join(dirPath, ".git");
    if (fs.existsSync(gitFile) && !known.has(dirPath)) {
      orphanPaths.push(dirPath);
    }
  }

  if (orphanPaths.length === 0) {
    return;
  }

  // `git worktree repair <path>...` re-creates the back-references in
  // `.git/worktrees/` for each listed path.
  try {
    await git(repoRoot, ["worktree", "repair", ...orphanPaths]);
  } catch {
    // Repair failed — check each orphan individually.
    for (const orphanPath of orphanPaths) {
      const gitFile = path.join(orphanPath, ".git");
      try {
        const content = fs.readFileSync(gitFile, "utf8");
        if (content.startsWith("gitdir: ")) {
          const gitdir = content.slice("gitdir: ".length).trim();
          const resolvedGitdir = path.isAbsolute(gitdir)
            ? gitdir
            : path.join(orphanPath, gitdir);
          if (!fs.existsSync(resolvedGitdir)) {
            fs.rmSync(orphanPath, { recursive: true, force: true });
            continue;
          }
        }
      } catch {
        // Unreadable .git file — leave it alone.
      }
      warn(`Failed to repair orphaned worktree: ${orphanPath}`);
    }
  }
}
