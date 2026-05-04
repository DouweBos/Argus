/**
 * Low-level git CLI utilities and worktree directory helpers.
 */

import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { warn } from "../../../app/lib/logger";
import { argusHomeDir } from "../../lib/argusHome";
import { classifyGitStderr } from "./gitError";

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

  return path.join(argusHomeDir(), "worktrees", `${name}-argus-worktrees`);
}

/**
 * Sanitise a branch name so it is safe to use as a directory component.
 * Replaces characters that are invalid in path components with underscores.
 */
export function branchToDir(branch: string): string {
  return branch.replace(/[/\\:*?"<>| ]/g, "_");
}

/**
 * Convert a session title to a valid git branch name (slug).
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

  return slug.length === 0
    ? "session"
    : truncateSlug(slug, MAX_BRANCH_SLUG_LENGTH);
}

/**
 * Maximum length for a generated branch slug. Git itself allows very long
 * refs, but filesystems impose a 255-byte limit on path components — and
 * git creates `<branch>.lock` files under `.git/refs/heads/`, which fails
 * with `File name too long` well before that limit when the branch name
 * approaches it. Keep slugs compact so they're readable and safe.
 */
const MAX_BRANCH_SLUG_LENGTH = 50;

/**
 * Truncate a slug to `max` characters, preferring to cut at a hyphen so we
 * don't slice mid-word. Strips trailing separators.
 */
function truncateSlug(slug: string, max: number): string {
  if (slug.length <= max) {
    return slug;
  }
  const head = slug.slice(0, max);
  const lastHyphen = head.lastIndexOf("-");
  const cut = lastHyphen > max / 2 ? head.slice(0, lastHyphen) : head;

  return cut.replace(/[-_]+$/g, "") || slug.slice(0, max);
}

// ---------------------------------------------------------------------------
// Git helpers (shell out to `git`)
// ---------------------------------------------------------------------------

/**
 * Run a `git` command in `cwd`, capturing stdout + stderr.
 *
 * Returns stdout on success; throws a typed `GitError` (classified from
 * stderr) on non-zero exit.
 */
export async function git(cwd: string, args: string[]): Promise<string> {
  // `--no-optional-locks` prevents read-only commands (diff, status, log) from
  // taking `.git/index.lock` to refresh the index. Without it, two concurrent
  // reads — or a read racing a stage/commit — fail with "Another git process
  // is holding the index lock". Equivalent to `GIT_OPTIONAL_LOCKS=0`.
  const finalArgs = ["--no-optional-locks", ...args];
  try {
    const { stdout } = await execFileAsync("git", finalArgs, { cwd });

    return stdout;
  } catch (err: unknown) {
    // execFile rejects with an object that has stdout/stderr when the process
    // exits with a non-zero code.
    const e = err as { stdout?: string; stderr?: string; message?: string };
    const stdout = e.stdout ?? "";
    const stderr = e.stderr ?? "";
    const combined =
      stderr || stdout || e.message || `git ${args.join(" ")} failed`;
    throw classifyGitStderr(combined, { op: args[0] ?? "" });
  }
}

// ---------------------------------------------------------------------------
// Repair orphaned worktrees
// ---------------------------------------------------------------------------

/**
 * Reconcile git's worktree metadata with the managed worktrees directory:
 *
 * 1. `git worktree prune` — drop metadata for worktrees whose directory is
 *    gone (e.g. external tools deleting `.claude/worktrees/<name>` by hand).
 * 2. `git worktree repair` — re-register directories that exist on disk with
 *    a valid `.git` file but are not known to git, fixing the case where the
 *    back-reference was removed but the working directory was left intact.
 */
export async function repairOrphanedWorktrees(repoRoot: string): Promise<void> {
  // Drop git's metadata for worktrees whose directory is gone — e.g. when an
  // external tool (Claude Code's Agent tool, a script, manual `rm -rf`) deletes
  // the working dir without `git worktree remove`. The leftover entries under
  // `.git/worktrees/<name>/` cause every later git invocation in any sibling
  // worktree to fail with `fatal: not a git repository: …/.git/worktrees/<name>`.
  try {
    await git(repoRoot, ["worktree", "prune"]);
  } catch {
    // Non-fatal — if prune fails we still attempt the orphan-repair below.
  }

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
