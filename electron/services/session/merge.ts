/**
 * Merge and conflict detection between session branches.
 */

import { execFile } from "node:child_process";
import fs from "node:fs";
import { git } from "./git";

// ---------------------------------------------------------------------------
// check_merge_conflicts
// ---------------------------------------------------------------------------

/**
 * Returns a list of files that would conflict if `sessionBranch` were merged
 * into `baseBranch`. Returns an empty array if no conflicts would occur.
 *
 * Uses `git merge-tree --write-tree` (git 2.38+). Parses the conflict info
 * section (stage entries) which is always present when conflicts exist,
 * regardless of whether informational CONFLICT messages are emitted.
 */
export async function checkMergeConflicts(
  repoRoot: string,
  sessionBranch: string,
  baseBranch: string,
  wsPath?: string,
): Promise<string[]> {
  // Find the merge base — fail fast when branches have no shared history.
  const mergeBase = (
    await git(repoRoot, ["merge-base", baseBranch, sessionBranch])
  ).trim();

  if (!mergeBase) {
    throw "No common ancestor between branches";
  }

  // Merge targets the effective state the merge will actually commit —
  // including anything currently staged in the session worktree. Without
  // this, conflicts introduced by uncommitted index entries go undetected
  // until the merge runs and aborts mid-flight.
  const cwd = wsPath ?? repoRoot;
  const sessionRef = wsPath
    ? ((await effectiveSessionRef(wsPath)) ?? sessionBranch)
    : sessionBranch;

  // `git merge-tree --write-tree` detects conflicts without touching the
  // working tree. Exit code behavior varies across git versions — always
  // parse stdout.
  const stdout: string = await new Promise((resolve) => {
    execFile(
      "git",
      ["merge-tree", "--write-tree", sessionRef, baseBranch],
      { cwd, maxBuffer: 32 * 1024 * 1024 },
      (_err: Error | null, out: string) => resolve(out || ""),
    );
  });

  const unique = [...new Set(parseConflictingFiles(stdout))].sort();

  return unique;
}

/**
 * Synthesise a throwaway commit that captures the current index (staged
 * changes) on top of HEAD, and return its SHA. Returns `null` when the index
 * is clean — callers should fall back to using the branch ref directly.
 *
 * The loose object never touches any ref, so it is collected by git gc; the
 * ephemeral hash is only used to feed `git merge-tree`.
 */
async function effectiveSessionRef(wsPath: string): Promise<string | null> {
  try {
    await git(wsPath, ["diff", "--cached", "--quiet"]);

    return null;
  } catch {
    // Staged changes present — fall through.
  }
  try {
    const tree = (await git(wsPath, ["write-tree"])).trim();
    if (!tree) {
      return null;
    }
    const head = (await git(wsPath, ["rev-parse", "HEAD"])).trim();
    if (!head) {
      return null;
    }
    const commit = (
      await git(wsPath, [
        "commit-tree",
        tree,
        "-p",
        head,
        "-m",
        "argus: staged (conflict pre-check)",
      ])
    ).trim();

    return commit || null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// merge_session_into_base
// ---------------------------------------------------------------------------

/**
 * Rebase `sessionBranch` onto `baseBranch`, then fast-forward `baseBranch`
 * to the rebased tip. Keeps history linear — no merge commits.
 *
 * Commits any staged changes in the session before rebasing. Aborts a
 * failed rebase so the session is left in a clean state.
 */
export async function mergeSessionIntoBase(
  repoRoot: string,
  wsPath: string,
  sessionBranch: string,
  baseBranch: string,
): Promise<void> {
  if (!fs.existsSync(wsPath)) {
    throw `Session worktree not found at ${wsPath}`;
  }

  // Commit any staged changes in the session worktree before rebasing.
  try {
    // `diff --cached --quiet` exits non-zero when there are staged changes.
    await git(wsPath, ["diff", "--cached", "--quiet"]);
  } catch {
    const message = await buildStagedCommitMessage(wsPath, sessionBranch);
    await git(wsPath, ["commit", "-m", message]);
  }

  // Pre-check for conflicts before touching the working tree. Pass `wsPath`
  // so any still-uncommitted staged changes (e.g. added between the UI
  // refresh and the merge click) are included in the check.
  const conflicts = await checkMergeConflicts(
    repoRoot,
    sessionBranch,
    baseBranch,
    wsPath,
  );
  if (conflicts.length > 0) {
    throw `Cannot merge: ${conflicts.length} conflicting file(s):\n${conflicts.join("\n")}`;
  }

  // Rebase the session branch onto the base branch — unless the base is
  // already reachable from HEAD (the session merged base in locally to
  // resolve conflicts). In that case rebase would replay the pre-merge commits
  // against the new base and re-hit conflicts the merge commit already
  // resolved, which is also why the conflict pre-check (merge semantics)
  // disagrees with the operation (rebase semantics).
  const baseAlreadyInHistory = await isAncestor(wsPath, baseBranch, "HEAD");
  if (!baseAlreadyInHistory) {
    try {
      await git(wsPath, ["rebase", baseBranch]);
    } catch (e) {
      // Leave the session in a clean state on failure.
      try {
        await git(wsPath, ["rebase", "--abort"]);
      } catch {
        // Ignore abort failures — surface the original error below.
      }
      throw e;
    }
  }

  // Squash all session commits into a single conventional commit.
  await squashSessionCommits(wsPath, sessionBranch, baseBranch);

  // Fast-forward the base branch to the rebased tip. If the base branch is
  // checked out in a worktree, update it there; otherwise update the ref
  // directly (safe because the rebase guarantees a fast-forward).
  const existingCheckout = await findWorktreeForBranch(repoRoot, baseBranch);
  if (existingCheckout) {
    await git(existingCheckout, ["merge", "--ff-only", sessionBranch]);
  } else {
    await git(repoRoot, ["branch", "-f", baseBranch, sessionBranch]);
  }
}

// ---------------------------------------------------------------------------
// rebase_session_on_base
// ---------------------------------------------------------------------------

/**
 * Rebase the session branch onto `baseBranch`, in place. Unlike
 * {@link mergeSessionIntoBase}, this does not fast-forward the base branch —
 * it only updates the session so it sits on top of the latest base.
 *
 * Aborts a failed rebase so the worktree is left clean. Does nothing when
 * the base branch is already reachable from HEAD.
 */
export async function rebaseSessionOnBase(
  wsPath: string,
  baseBranch: string,
): Promise<void> {
  if (!fs.existsSync(wsPath)) {
    throw `Session worktree not found at ${wsPath}`;
  }

  const baseAlreadyInHistory = await isAncestor(wsPath, baseBranch, "HEAD");
  if (baseAlreadyInHistory) {
    return;
  }

  try {
    await git(wsPath, ["rebase", baseBranch]);
  } catch (e) {
    try {
      await git(wsPath, ["rebase", "--abort"]);
    } catch {
      // Ignore abort failures — surface the original error below.
    }
    throw e;
  }
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Collapse every commit ahead of `baseBranch` on the current session branch
 * into a single commit. The subject uses a conventional-commit prefix derived
 * from the original commit messages (fix > feat > chore, default feat) and a
 * summary derived from the branch name. The body lists the original subjects.
 *
 * No-op when there are 0 or 1 commits ahead of the base.
 */
async function squashSessionCommits(
  wsPath: string,
  sessionBranch: string,
  baseBranch: string,
): Promise<void> {
  const log = await git(wsPath, ["log", `${baseBranch}..HEAD`, "--pretty=%s"]);
  const subjects = log
    .split("\n")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  if (subjects.length <= 1) {
    return;
  }

  const type = deriveCommitType(subjects);
  const summary = branchToSummary(sessionBranch);
  // Reverse so the body reads oldest → newest.
  const body = subjects
    .slice()
    .reverse()
    .map((s) => `- ${s}`)
    .join("\n");
  const message = `${type}: ${summary}\n\n${body}`;

  await git(wsPath, ["reset", "--soft", baseBranch]);
  await git(wsPath, ["commit", "-m", message]);
}

/**
 * Build a conventional-commit message for the pre-merge commit that captures
 * whatever an agent left staged in the session. The subject derives from the
 * branch name; the body lists the staged files grouped by status so reviewers
 * can see the shape of the change at a glance.
 */
async function buildStagedCommitMessage(
  wsPath: string,
  sessionBranch: string,
): Promise<string> {
  const summary = branchToSummary(sessionBranch);
  const nameStatus = await git(wsPath, ["diff", "--cached", "--name-status"]);

  const added: string[] = [];
  const modified: string[] = [];
  const deleted: string[] = [];
  const renamed: string[] = [];
  const other: string[] = [];

  for (const line of nameStatus.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }
    const parts = trimmed.split("\t");
    const status = parts[0]?.[0] ?? "";
    const pathA = parts[1] ?? "";
    const pathB = parts[2];

    if (status === "A") {
      added.push(pathA);
    } else if (status === "M") {
      modified.push(pathA);
    } else if (status === "D") {
      deleted.push(pathA);
    } else if (status === "R" && pathB) {
      renamed.push(`${pathA} → ${pathB}`);
    } else if (pathA) {
      other.push(pathA);
    }
  }

  const type = deriveTypeFromFiles(added, modified, deleted);
  const bodyLines: string[] = [];
  const section = (label: string, items: string[]) => {
    if (items.length === 0) {
      return;
    }
    bodyLines.push(label);
    for (const item of items) {
      bodyLines.push(`- ${item}`);
    }
    bodyLines.push("");
  };
  section("Added:", added);
  section("Modified:", modified);
  section("Deleted:", deleted);
  section("Renamed:", renamed);
  section("Changed:", other);

  const body = bodyLines.join("\n").trimEnd();

  return body ? `${type}: ${summary}\n\n${body}` : `${type}: ${summary}`;
}

/**
 * Pick a conventional-commit type based on the file-status mix of the staged
 * changes. Pure deletions read as chores; everything else is a feature commit
 * by default (the agent presumably built or changed something).
 */
function deriveTypeFromFiles(
  added: string[],
  modified: string[],
  deleted: string[],
): "chore" | "feat" {
  if (added.length === 0 && modified.length === 0 && deleted.length > 0) {
    return "chore";
  }

  return "feat";
}

/**
 * Pick a conventional-commit type from a list of commit subjects.
 * Priority: fix > feat > chore. Defaults to "feat" when no subject carries a
 * recognised prefix.
 */
function deriveCommitType(subjects: string[]): "chore" | "feat" | "fix" {
  const has = (t: string) =>
    subjects.some((s) => new RegExp(`^${t}(\\([^)]*\\))?!?:`, "i").test(s));

  if (has("fix")) {
    return "fix";
  }
  if (has("feat")) {
    return "feat";
  }
  if (subjects.every((s) => /^chore(\([^)]*\))?!?:/i.test(s))) {
    return "chore";
  }

  return "feat";
}

/**
 * Convert a branch name into a human-readable summary for a commit subject.
 * Takes the final path segment and replaces separators with spaces.
 */
function branchToSummary(branch: string): string {
  const last = branch.split("/").pop() ?? branch;

  return last.replace(/[-_]+/g, " ").trim() || branch;
}

/**
 * Return the path of an existing worktree that currently has `branch` checked
 * out, or `null` if none does. Parses `git worktree list --porcelain`.
 */
async function findWorktreeForBranch(
  repoRoot: string,
  branch: string,
): Promise<string | null> {
  const raw = await git(repoRoot, ["worktree", "list", "--porcelain"]);
  const fullRef = `refs/heads/${branch}`;
  let currentPath: string | null = null;

  for (const line of raw.split("\n")) {
    if (line.startsWith("worktree ")) {
      currentPath = line.slice("worktree ".length).trim();
    } else if (line.startsWith("branch ")) {
      const ref = line.slice("branch ".length).trim();
      if (ref === fullRef && currentPath) {
        return currentPath;
      }
    } else if (line === "") {
      currentPath = null;
    }
  }

  return null;
}

/**
 * Returns true when `ancestor` is reachable from `descendant` (i.e. descendant
 * has ancestor in its history). Wraps `git merge-base --is-ancestor`, which
 * communicates the answer via exit code.
 */
async function isAncestor(
  wsPath: string,
  ancestor: string,
  descendant: string,
): Promise<boolean> {
  return new Promise((resolve) => {
    execFile(
      "git",
      ["merge-base", "--is-ancestor", ancestor, descendant],
      { cwd: wsPath },
      (err) => resolve(!err),
    );
  });
}

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
        const filePath = trimmed
          .slice(idx + "merge conflict in ".length)
          .trim();
        if (filePath) {
          conflicts.push(filePath);
        }
      }
    }
  }

  return conflicts;
}
