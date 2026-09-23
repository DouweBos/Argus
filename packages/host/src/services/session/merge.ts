/**
 * Merge and conflict detection between session branches.
 */

import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { capture as telemetryCapture } from "../telemetry/telemetry";
import { git } from "./git";
import { assertWorktreePresent } from "./volumeAvailability";

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
  assertWorktreePresent(wsPath);

  await commitStagedChanges(wsPath, sessionBranch);

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

  await fastForwardBase(repoRoot, sessionBranch, baseBranch);
}

// ---------------------------------------------------------------------------
// resumable merge: attempt / continue / abort / status
// ---------------------------------------------------------------------------

/** Snapshot of a session's merge readiness vs. its base branch. */
export interface SessionMergeStatus {
  base_branch: string | null;
  ahead: number;
  behind: number;
  uncommitted_changes: number;
  staged_changes: number;
  untracked_files: number;
  /**
   * `rebase` or `merge` if the worktree is mid-operation. Includes the list of
   * files git currently considers conflicted (from `--diff-filter=U`). Null
   * when no operation is in progress.
   */
  in_progress: {
    kind: "merge" | "rebase";
    conflicting_files: string[];
  } | null;
  /**
   * Files that would conflict on a fresh merge attempt, computed from
   * `git merge-tree --write-tree`. Empty during an in-progress merge — read
   * `in_progress.conflicting_files` instead.
   */
  predicted_conflicts: string[];
  can_merge_clean: boolean;
}

/**
 * Comprehensive merge-readiness report for an orchestrator deciding what to
 * do with a session: clean merge, predicted conflicts, or already in the
 * middle of a paused merge waiting for resolution.
 */
export async function getSessionMergeStatus(
  repoRoot: string,
  wsPath: string,
  sessionBranch: string,
  baseBranch: string | null,
): Promise<SessionMergeStatus> {
  assertWorktreePresent(wsPath);

  const status = await git(wsPath, [
    "status",
    "--porcelain=v1",
    "--untracked-files=all",
  ]);
  let uncommitted = 0;
  let staged = 0;
  let untracked = 0;
  for (const line of status.split("\n")) {
    if (!line) {
      continue;
    }
    const indexFlag = line.charAt(0);
    const treeFlag = line.charAt(1);
    if (indexFlag === "?" && treeFlag === "?") {
      untracked += 1;
      continue;
    }
    if (indexFlag !== " " && indexFlag !== "?") {
      staged += 1;
    }
    if (treeFlag !== " " && treeFlag !== "?") {
      uncommitted += 1;
    }
  }

  const inProgress = await detectInProgressMerge(wsPath);

  let ahead = 0;
  let behind = 0;
  let predicted: string[] = [];
  let canMerge = false;

  if (baseBranch) {
    try {
      const counts = (
        await git(wsPath, [
          "rev-list",
          "--left-right",
          "--count",
          `${baseBranch}...HEAD`,
        ])
      ).trim();
      const [b, a] = counts.split("\t").map((n) => parseInt(n, 10) || 0);
      behind = b;
      ahead = a;
    } catch {
      // No upstream relationship — leave both at 0.
    }

    if (!inProgress) {
      try {
        predicted = await checkMergeConflicts(
          repoRoot,
          sessionBranch,
          baseBranch,
          wsPath,
        );
      } catch {
        predicted = [];
      }
      canMerge = predicted.length === 0 && ahead > 0;
    }
  }

  return {
    base_branch: baseBranch,
    ahead,
    behind,
    uncommitted_changes: uncommitted,
    staged_changes: staged,
    untracked_files: untracked,
    in_progress: inProgress,
    predicted_conflicts: predicted,
    can_merge_clean: canMerge,
  };
}

/**
 * Run the same flow as {@link mergeSessionIntoBase}, but on rebase conflict
 * leave the worktree paused (markers in place, `git rebase --continue`
 * pending) instead of aborting. Returns whether the merge completed or is
 * waiting for resolution.
 */
export async function attemptMergeSession(
  repoRoot: string,
  wsPath: string,
  sessionBranch: string,
  baseBranch: string,
): Promise<
  { state: "conflicted"; conflicting_files: string[] } | { state: "merged" }
> {
  assertWorktreePresent(wsPath);

  // Refuse to start a new attempt while another is in progress.
  const existing = await detectInProgressMerge(wsPath);
  if (existing) {
    throw `A ${existing.kind} is already in progress in this worktree — call continue_merge or abort_merge first`;
  }

  await commitStagedChanges(wsPath, sessionBranch);

  const baseAlreadyInHistory = await isAncestor(wsPath, baseBranch, "HEAD");
  if (!baseAlreadyInHistory) {
    try {
      await git(wsPath, ["rebase", baseBranch]);
    } catch {
      // Don't abort — surface the conflict state to the caller.
      const conflictingFiles = await listConflictingFiles(wsPath);
      telemetryCapture("session_merge_conflict", {
        conflicting_files: conflictingFiles.length,
        phase: "attempt",
      });

      return { conflicting_files: conflictingFiles, state: "conflicted" };
    }
  }

  await squashSessionCommits(wsPath, sessionBranch, baseBranch);
  await fastForwardBase(repoRoot, sessionBranch, baseBranch);

  telemetryCapture("session_merged", { phase: "attempt" });

  return { state: "merged" };
}

/**
 * Continue a paused rebase by staging all current changes and running
 * `git rebase --continue`. If conflicts persist after the next commit,
 * returns `conflicted` again so the caller can iterate. On success, finalises
 * with the same squash + fast-forward base flow as a normal merge.
 */
export async function continueSessionMerge(
  repoRoot: string,
  wsPath: string,
  sessionBranch: string,
  baseBranch: string,
): Promise<
  | { state: "conflicted"; conflicting_files: string[] }
  | { state: "merged" }
  | { state: "no-merge-in-progress" }
> {
  const inProgress = await detectInProgressMerge(wsPath);
  if (!inProgress) {
    return { state: "no-merge-in-progress" };
  }

  // Stage everything in the worktree so the resolution lands on the rebase
  // commit. Untracked files are left alone — the orchestrator can git-add
  // them deliberately by calling write_session_file (which auto-stages).
  await git(wsPath, ["add", "-u"]);

  // Pick up files that were created during resolution as well.
  await git(wsPath, ["add", "-A"]);

  if (inProgress.kind === "rebase") {
    try {
      await runRebaseContinue(wsPath);
    } catch {
      const conflictingFiles = await listConflictingFiles(wsPath);
      telemetryCapture("session_merge_conflict", {
        conflicting_files: conflictingFiles.length,
        phase: "continue",
      });

      return { conflicting_files: conflictingFiles, state: "conflicted" };
    }
  } else {
    // Plain merge — commit the resolution.
    try {
      await git(wsPath, ["commit", "--no-edit"]);
    } catch {
      const conflictingFiles = await listConflictingFiles(wsPath);
      telemetryCapture("session_merge_conflict", {
        conflicting_files: conflictingFiles.length,
        phase: "continue",
      });

      return { conflicting_files: conflictingFiles, state: "conflicted" };
    }
  }

  await squashSessionCommits(wsPath, sessionBranch, baseBranch);
  await fastForwardBase(repoRoot, sessionBranch, baseBranch);

  telemetryCapture("session_merged", { phase: "continue" });

  return { state: "merged" };
}

/**
 * Abort an in-progress merge or rebase, restoring the worktree to a clean
 * state so the orchestrator can decide what to do next.
 */
export async function abortSessionMerge(wsPath: string): Promise<void> {
  const inProgress = await detectInProgressMerge(wsPath);
  if (!inProgress) {
    return;
  }
  if (inProgress.kind === "rebase") {
    await git(wsPath, ["rebase", "--abort"]);
  } else {
    await git(wsPath, ["merge", "--abort"]);
  }
  telemetryCapture("session_merge_aborted", { kind: inProgress.kind });
}

/** Detect a paused merge or rebase by inspecting the worktree's gitdir. */
async function detectInProgressMerge(
  wsPath: string,
): Promise<{ conflicting_files: string[]; kind: "merge" | "rebase" } | null> {
  let gitDir: string;
  try {
    gitDir = (await git(wsPath, ["rev-parse", "--git-dir"])).trim();
  } catch {
    return null;
  }
  if (!gitDir) {
    return null;
  }
  const absGitDir = path.isAbsolute(gitDir)
    ? gitDir
    : path.resolve(wsPath, gitDir);

  const hasRebase =
    fs.existsSync(`${absGitDir}/rebase-merge`) ||
    fs.existsSync(`${absGitDir}/rebase-apply`);
  const hasMerge = fs.existsSync(`${absGitDir}/MERGE_HEAD`);

  if (!hasRebase && !hasMerge) {
    return null;
  }

  const conflicting = await listConflictingFiles(wsPath);

  return {
    conflicting_files: conflicting,
    kind: hasRebase ? "rebase" : "merge",
  };
}

/** List files git considers unmerged (`--diff-filter=U`). */
async function listConflictingFiles(wsPath: string): Promise<string[]> {
  try {
    const raw = await git(wsPath, ["diff", "--name-only", "--diff-filter=U"]);

    return raw
      .split("\n")
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
  } catch {
    return [];
  }
}

/**
 * Run `git rebase --continue`. Sets `GIT_EDITOR=true` so any squash/fixup
 * todo doesn't block on an interactive editor — the rebase just keeps the
 * existing commit messages.
 */
function runRebaseContinue(wsPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile(
      "git",
      ["rebase", "--continue"],
      { cwd: wsPath, env: { ...process.env, GIT_EDITOR: "true" } },
      (err, _stdout, stderr) => {
        if (err) {
          reject(stderr || (err.message ?? "git rebase --continue failed"));
        } else {
          resolve();
        }
      },
    );
  });
}

/**
 * Fast-forward the base branch to the session tip. Extracted from
 * {@link mergeSessionIntoBase} so the resumable flow can share it.
 */
async function fastForwardBase(
  repoRoot: string,
  sessionBranch: string,
  baseBranch: string,
): Promise<void> {
  await assertLocalBranch(repoRoot, baseBranch);

  const existingCheckout = await findWorktreeForBranch(repoRoot, baseBranch);
  if (existingCheckout) {
    await git(existingCheckout, ["merge", "--ff-only", sessionBranch]);
  } else {
    await git(repoRoot, ["branch", "-f", baseBranch, sessionBranch]);
  }
}

/**
 * Throw if `baseBranch` is not an existing local branch.
 *
 * Why: downstream we run `git branch -f <baseBranch> <sessionBranch>` to
 * fast-forward the base. Git accepts `/` in branch names, so passing a
 * remote-qualified name like `origin/main` silently creates a bogus local
 * branch literally named `origin/main` instead of moving the real base.
 * Catching this here turns the silent corruption into a clear error.
 */
async function assertLocalBranch(
  repoRoot: string,
  baseBranch: string,
): Promise<void> {
  const localExists = await refExists(repoRoot, `refs/heads/${baseBranch}`);
  if (localExists) {
    return;
  }
  const remoteExists = await refExists(repoRoot, `refs/remotes/${baseBranch}`);
  if (remoteExists) {
    const stripped = baseBranch.split("/").slice(1).join("/");
    throw `Base branch "${baseBranch}" is a remote-tracking ref, not a local branch. Set the base to "${stripped}" instead.`;
  }
  throw `Base branch "${baseBranch}" does not exist locally.`;
}

function refExists(repoRoot: string, ref: string): Promise<boolean> {
  return new Promise((resolve) => {
    execFile(
      "git",
      ["show-ref", "--verify", "--quiet", ref],
      { cwd: repoRoot },
      (err) => resolve(!err),
    );
  });
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
  sessionBranch: string,
  baseBranch: string,
): Promise<void> {
  assertWorktreePresent(wsPath);

  await commitStagedChanges(wsPath, sessionBranch);

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
 * summary derived from the branch name.
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
  const message = `${type}: ${summary}`;

  await git(wsPath, ["reset", "--soft", baseBranch]);
  await git(wsPath, ["commit", "-m", message]);
}

/**
 * Stage everything in the session worktree (tracked changes + untracked files)
 * and commit it as a conventional commit, so a subsequent rebase isn't blocked
 * by git's "Your index contains uncommitted changes" guard and so the merge
 * captures all the agent's work — committed or not. No-op when the worktree
 * is fully clean.
 */
async function commitStagedChanges(
  wsPath: string,
  sessionBranch: string,
): Promise<void> {
  // Stage every tracked modification, deletion, and untracked file. Anything
  // ignored by .gitignore stays out, which matches user expectations.
  await git(wsPath, ["add", "-A"]);

  try {
    // `diff --cached --quiet` exits non-zero when there are staged changes.
    await git(wsPath, ["diff", "--cached", "--quiet"]);

    return;
  } catch {
    // Fall through — there's something staged.
  }
  const message = await buildStagedCommitMessage(wsPath, sessionBranch);
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
