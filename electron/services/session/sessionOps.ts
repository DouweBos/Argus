/**
 * IPC-facing session operation functions: diff, status, config, branches,
 * file watching, and merge.
 *
 * Each function looks up the session from `appState.sessions` and
 * delegates to the lower-level modules.
 */

import type { SessionMergeStatus } from "./merge";
import { execFile } from "node:child_process";
import fs from "node:fs";
import nodePath from "node:path";
import { emitHostEvent } from "@argus/host/bus";
import { info } from "../../../app/lib/logger";
import { appState } from "../../state";
import { listClaudeAccounts } from "../claudeAuth/accounts";
import { git, worktreesRoot } from "./git";
import { withGitLock } from "./gitLock";
import { attachGitWatcher } from "./gitWatcher";
import {
  checkMergeConflicts,
  abortSessionMerge as doAbortSessionMerge,
  attemptMergeSession as doAttemptMergeSession,
  continueSessionMerge as doContinueSessionMerge,
  getSessionMergeStatus as doGetSessionMergeStatus,
  mergeSessionIntoBase as doMergeSessionIntoBase,
  rebaseSessionOnBase as doRebaseSessionOnBase,
} from "./merge";
import { loadMetadata, saveMetadata } from "./metadata";
import { defaultArgusConfig, type ArgusConfig } from "./models";
import { buildPullRequestUrl, pickPullRequestTemplate } from "./pullRequest";
import { isBranchProtected, loadArgusConfig } from "./setup";
import { startWatcher, type WatcherHandle } from "./watcher";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * True when `name` refers to a remote-tracking ref (`refs/remotes/<name>`)
 * but no local branch with that name exists. Used to refuse remote-qualified
 * names like `origin/main` at base-branch entry points.
 */
function isRemoteOnlyRef(repoRoot: string, name: string): Promise<boolean> {
  const check = (ref: string) =>
    new Promise<boolean>((resolve) => {
      execFile(
        "git",
        ["show-ref", "--verify", "--quiet", ref],
        { cwd: repoRoot },
        (err) => resolve(!err),
      );
    });

  return Promise.all([
    check(`refs/heads/${name}`),
    check(`refs/remotes/${name}`),
  ]).then(([local, remote]) => !local && remote);
}

/** Look up a session's path by ID, or throw. */
function sessionPath(id: string): string {
  const ws = appState.sessions.get(id);
  if (!ws) {
    throw `Session not found: ${id}`;
  }

  return ws.path;
}

// ---------------------------------------------------------------------------
// get_repo_branch / list_branches / checkout_branch
// ---------------------------------------------------------------------------

/** Return the currently checked-out branch of the repo root. */
export async function getRepoBranch(repoRoot: string): Promise<string> {
  return (await git(repoRoot, ["rev-parse", "--abbrev-ref", "HEAD"])).trim();
}

/** Return all local branch names for the repo root, sorted alphabetically. */
export async function listBranches(repoRoot: string): Promise<string[]> {
  const raw = await git(repoRoot, ["branch", "--list"]);

  return raw
    .split("\n")
    .map((l) => l.replace(/^[*+]?\s+/, "").trim())
    .filter((b) => b.length > 0)
    .sort();
}

export interface BranchList {
  local: string[];
  remote: string[];
  originRefs: string[];
}

/** Return local + remote branch names, with remote deduped against local. */
export async function listAllBranches(repoRoot: string): Promise<BranchList> {
  const localRaw = await git(repoRoot, [
    "for-each-ref",
    "--format=%(refname:short)",
    "refs/heads/",
  ]);
  const local = localRaw
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0)
    .sort();

  const localSet = new Set(local);

  const remoteRaw = await git(repoRoot, [
    "for-each-ref",
    "--format=%(refname:short)",
    "refs/remotes/origin/",
  ]);
  const remoteShort = remoteRaw
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.startsWith("origin/"))
    .map((l) => l.slice("origin/".length))
    .filter((l) => l.length > 0 && l !== "HEAD")
    .sort();

  const remote = remoteShort.filter((l) => !localSet.has(l));
  const originRefs = remoteShort.map((l) => `origin/${l}`);

  return { local, remote, originRefs };
}

/** Checkout an existing local branch in the repo root. */
export async function checkoutBranch(
  repoRoot: string,
  branch: string,
): Promise<void> {
  await git(repoRoot, ["checkout", branch]);
}

// ---------------------------------------------------------------------------
// get_session_diff / get_session_full_diff / get_session_staged_diff /
// get_session_untracked_diff / get_session_status
// ---------------------------------------------------------------------------

/** Return `git diff` output (unstaged changes) for a session. */
export async function getSessionDiff(id: string): Promise<string> {
  return git(sessionPath(id), ["diff"]);
}

/** Return `git diff HEAD` output (staged + unstaged vs HEAD) for a session. */
export async function getSessionFullDiff(id: string): Promise<string> {
  return git(sessionPath(id), ["diff", "HEAD"]);
}

/**
 * Return the diff of the entire session branch vs its base branch — covers
 * committed, staged, and unstaged changes together. Uses the merge-base so
 * changes that happened on the base branch after divergence don't appear
 * inverted.
 *
 * When the base branch is protected, anchors against `origin/<base_branch>`
 * instead of the local copy. Protected branches don't get merged back
 * locally, so what matters for review/PR is the total diff against the
 * remote tip — not against an arbitrarily stale local checkout.
 *
 * Returns an empty string when the session has no base branch.
 */
export async function getSessionBranchDiff(
  id: string,
  opts?: DiffOpts,
): Promise<string> {
  const ws = appState.sessions.get(id);
  if (!ws || ws.kind === "project_root" || !ws.base_branch) {
    return "";
  }
  const wtPath = sessionPath(id);

  let baseRef = ws.base_branch;
  if (isBranchProtected(ws.repo_root, ws.base_branch)) {
    const remoteRef = `origin/${ws.base_branch}`;
    try {
      await git(wtPath, ["rev-parse", "--verify", remoteRef]);
      baseRef = remoteRef;
    } catch {
      // Remote tracking ref missing — fall back to the local branch.
    }
  }

  let mergeBase: string;
  try {
    mergeBase = (await git(wtPath, ["merge-base", baseRef, "HEAD"])).trim();
  } catch {
    return "";
  }
  if (!mergeBase) {
    return "";
  }

  return git(wtPath, ["diff", ...diffFlags(opts), mergeBase]);
}

/** Return `git diff --cached` output (staged only) for a session. */
export async function getSessionStagedDiff(
  id: string,
  opts?: DiffOpts,
): Promise<string> {
  return git(sessionPath(id), ["diff", "--cached", ...diffFlags(opts)]);
}

/** Optional flags for diff fetches. */
export interface DiffOpts {
  ignoreWhitespace?: boolean;
  wordDiff?: boolean;
}

function diffFlags(opts?: DiffOpts): string[] {
  const args: string[] = [];
  if (opts?.ignoreWhitespace) {
    args.push("-w");
  }
  if (opts?.wordDiff) {
    args.push("--word-diff=plain");
  }

  return args;
}

/**
 * Return untracked files as synthetic unified diff output for a session.
 *
 * Uses `git ls-files --others --exclude-standard` then reads each file and
 * formats it as a unified diff.
 */
export async function getSessionUntrackedDiff(id: string): Promise<string> {
  const wtPath = sessionPath(id);
  const raw = await git(wtPath, ["ls-files", "--others", "--exclude-standard"]);

  let output = "";
  for (const filePath of raw.split("\n")) {
    const trimmed = filePath.trim();
    if (!trimmed) {
      continue;
    }

    const fullPath = `${wtPath}/${trimmed}`;
    let content: string;
    try {
      content = fs.readFileSync(fullPath, "utf8");
    } catch {
      // Skip binary or unreadable files.
      continue;
    }

    const lines = content.split("\n");
    // Remove the trailing empty element that split() adds for files ending in \n.
    if (lines[lines.length - 1] === "") {
      lines.pop();
    }
    const lineCount = lines.length;

    output += `diff --git a/${trimmed} b/${trimmed}\n`;
    output += `new file mode 100644\n`;
    output += `--- /dev/null\n`;
    output += `+++ b/${trimmed}\n`;
    output += `@@ -0,0 +1,${lineCount} @@\n`;
    for (const line of lines) {
      output += `+${line}\n`;
    }
  }

  return output;
}

/** Return `git status --short` output for a session. */
export async function getSessionStatus(id: string): Promise<string> {
  return git(sessionPath(id), ["status", "--short"]);
}

// ---------------------------------------------------------------------------
// stage_file / unstage_file / discard_file
// ---------------------------------------------------------------------------

/** Stage an entire file in a session. */
export async function stageFile(id: string, filePath: string): Promise<void> {
  const wt = sessionPath(id);
  await withGitLock(wt, async () => {
    await git(wt, ["add", "--", filePath]);
  });
}

/** Unstage an entire file (reset to HEAD) in a session. */
export async function unstageFile(id: string, filePath: string): Promise<void> {
  const wt = sessionPath(id);
  await withGitLock(wt, async () => {
    await git(wt, ["reset", "HEAD", "--", filePath]);
  });
}

/**
 * Stage all changes in the session tree in one `git add -A`.
 * Avoids hundreds of sequential `git add -- <path>` calls that contend for
 * `.git/index.lock` with each other and with the diff watcher’s polling.
 */
export async function stageAll(id: string): Promise<void> {
  const wt = sessionPath(id);
  await withGitLock(wt, async () => {
    await git(wt, ["add", "-A"]);
  });
}

/** Unstage all index entries in one `git reset HEAD`. */
export async function unstageAll(id: string): Promise<void> {
  const wt = sessionPath(id);
  await withGitLock(wt, async () => {
    await git(wt, ["reset", "HEAD"]);
  });
}

/**
 * Discard all changes to a tracked file (checkout from HEAD).
 * For untracked files, removes them from disk.
 */
export async function discardFile(id: string, filePath: string): Promise<void> {
  const wtPath = sessionPath(id);
  await withGitLock(wtPath, async () => {
    try {
      await git(wtPath, ["checkout", "HEAD", "--", filePath]);

      return;
    } catch {
      // Checkout failed — likely an untracked file.
    }
    const fullPath = `${wtPath}/${filePath}`;
    if (fs.existsSync(fullPath)) {
      fs.unlinkSync(fullPath);
    }
  });
}

// ---------------------------------------------------------------------------
// stage_hunk / unstage_hunk / discard_hunk
// ---------------------------------------------------------------------------

/** Apply a patch string via `git apply`, passing additional args. */
async function applyPatch(
  wtPath: string,
  patch: string,
  args: string[],
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = execFile(
      "git",
      ["apply", ...args],
      { cwd: wtPath },
      (err: Error | null, _stdout: string, stderr: string) => {
        if (err) {
          reject(`git apply failed: ${stderr}`);
        } else {
          resolve();
        }
      },
    );
    child.stdin?.write(patch);
    child.stdin?.end();
  });
}

/** Stage a hunk (patch string) in a session. */
export async function stageHunk(id: string, patch: string): Promise<void> {
  const wt = sessionPath(id);
  await withGitLock(wt, () => applyPatch(wt, patch, ["--cached"]));
}

/** Unstage a hunk (patch string) in a session. */
export async function unstageHunk(id: string, patch: string): Promise<void> {
  const wt = sessionPath(id);
  await withGitLock(wt, () => applyPatch(wt, patch, ["--cached", "--reverse"]));
}

/**
 * Discard a hunk (reverse-apply patch) in a session.
 *
 * When `staged` is true the patch represents content that exists in the
 * index, so it's also reverse-applied with `--cached` — otherwise the staged
 * copy survives the discard and downstream consumers (merge-conflict
 * prediction, diff view) keep seeing it.
 */
export async function discardHunk(
  id: string,
  patch: string,
  staged: boolean,
): Promise<void> {
  const wt = sessionPath(id);
  await withGitLock(wt, async () => {
    await applyPatch(wt, patch, ["--reverse"]);
    if (staged) {
      await applyPatch(wt, patch, ["--cached", "--reverse"]);
    }
  });
}

// ---------------------------------------------------------------------------
// git_commit / get_git_author / get_last_commit_message / get_last_commit_hash
// ---------------------------------------------------------------------------

/**
 * Commit staged changes in a session.
 *
 * If `amend` is true, amends the previous commit.
 */
export async function gitCommit(
  id: string,
  message: string,
  amend: boolean,
): Promise<string> {
  const args = ["commit", "-m", message];
  if (amend) {
    args.push("--amend");
  }

  const wt = sessionPath(id);
  const output = await withGitLock(wt, () => git(wt, args));

  // Emit a commit-landed activity event. Best-effort — lookup failures should
  // not abort the commit.
  try {
    const ws = appState.sessions.get(id);
    if (ws) {
      const hash = (await git(ws.path, ["log", "-1", "--format=%h"])).trim();
      const subject = (await git(ws.path, ["log", "-1", "--format=%s"])).trim();
      emitHostEvent("session:commit-landed", {
        sessionId: id,
        branch: ws.branch,
        hash,
        subject,
        amend,
      });
    }
  } catch {
    // Non-fatal.
  }

  return output;
}

/** Return the git author `[name, email]` configured for a session. */
export async function getGitAuthor(id: string): Promise<[string, string]> {
  const wtPath = sessionPath(id);
  let name = "";
  let email = "";
  try {
    name = (await git(wtPath, ["config", "user.name"])).trim();
  } catch {
    // No user.name configured — leave empty.
  }
  try {
    email = (await git(wtPath, ["config", "user.email"])).trim();
  } catch {
    // No user.email configured — leave empty.
  }

  return [name, email];
}

/** Return the full commit message of the most recent commit in a session. */
export async function getLastCommitMessage(id: string): Promise<string> {
  return (await git(sessionPath(id), ["log", "-1", "--format=%B"])).trim();
}

/** Return the abbreviated hash of the most recent commit in a session. */
export async function getLastCommitHash(id: string): Promise<string> {
  return (await git(sessionPath(id), ["log", "-1", "--format=%h"])).trim();
}

// ---------------------------------------------------------------------------
// git_log / git_show_commit / git_stash_list / git_stash_show
// ---------------------------------------------------------------------------

export interface GitCommit {
  hash: string;
  abbreviatedHash: string;
  author: string;
  authorEmail: string;
  date: string;
  committer: string;
  committerEmail: string;
  committerDate: string;
  parentHash: string;
  treeHash: string;
  subject: string;
  refs: string;
  body: string;
}

export interface GitStashEntry {
  index: number;
  hash: string;
  author: string;
  authorEmail: string;
  date: string;
  parentHash: string;
  message: string;
}

const COMMIT_SEP = "---COMMIT_SEP---";

/** Return recent commits as structured data. */
export async function gitLog(
  id: string,
  count: number = 100,
  allBranches: boolean = true,
): Promise<GitCommit[]> {
  const format = [
    "%H",
    "%h",
    "%an",
    "%ae",
    "%aI",
    "%cn",
    "%ce",
    "%cI",
    "%P",
    "%T",
    "%s",
    "%D",
    "%b",
  ].join("%n");
  const args = [
    "log",
    "--date-order",
    "--decorate=short",
    `--format=${format}${COMMIT_SEP}`,
    `-${count}`,
  ];
  if (allBranches) {
    args.splice(1, 0, "--exclude=refs/stash", "--all");
  }
  const raw = await git(sessionPath(id), args);
  const entries = raw.split(COMMIT_SEP).filter((s) => s.trim());

  return entries.map((entry) => {
    const lines = entry.trim().split("\n");

    return {
      hash: lines[0] ?? "",
      abbreviatedHash: lines[1] ?? "",
      author: lines[2] ?? "",
      authorEmail: lines[3] ?? "",
      date: lines[4] ?? "",
      committer: lines[5] ?? "",
      committerEmail: lines[6] ?? "",
      committerDate: lines[7] ?? "",
      parentHash: lines[8] ?? "",
      treeHash: lines[9] ?? "",
      subject: lines[10] ?? "",
      refs: lines[11] ?? "",
      body: lines.slice(12).join("\n").trim(),
    };
  });
}

/** Return the diff for a specific commit. */
export async function gitShowCommit(
  id: string,
  commitHash: string,
): Promise<string> {
  return git(sessionPath(id), [
    "diff-tree",
    "-p",
    "-r",
    "--root",
    "--no-commit-id",
    commitHash,
  ]);
}

/** Return the list of stashes as structured data. */
export async function gitStashList(id: string): Promise<GitStashEntry[]> {
  const raw = await git(sessionPath(id), [
    "stash",
    "list",
    `--format=%H%n%an%n%ae%n%aI%n%P%n%s${COMMIT_SEP}`,
  ]);
  if (!raw.trim()) {
    return [];
  }
  const entries = raw.split(COMMIT_SEP).filter((s) => s.trim());

  return entries.map((entry, i) => {
    const lines = entry.trim().split("\n");

    return {
      index: i,
      hash: lines[0] ?? "",
      author: lines[1] ?? "",
      authorEmail: lines[2] ?? "",
      date: lines[3] ?? "",
      parentHash: lines[4] ?? "",
      message: lines[5] ?? "",
    };
  });
}

/** Return the diff for a specific stash entry. */
export async function gitStashShow(
  id: string,
  stashIndex: number,
): Promise<string> {
  return git(sessionPath(id), ["stash", "show", "-p", `stash@{${stashIndex}}`]);
}

// ---------------------------------------------------------------------------
// git_pull / git_push / git_fetch / git_stash / git_stash_pop
// ---------------------------------------------------------------------------

/** Pull from the remote for a session. Optionally from a specific branch, with rebase. */
export async function gitPull(
  id: string,
  remoteBranch?: string,
  rebase?: boolean,
): Promise<string> {
  const args = ["pull"];
  if (rebase) {
    args.push("--rebase");
  }
  if (remoteBranch) {
    args.push("origin", remoteBranch);
  }
  const wt = sessionPath(id);

  return withGitLock(wt, () => git(wt, args));
}

/** Push to the remote for a session. */
export async function gitPush(id: string): Promise<string> {
  const wt = sessionPath(id);

  return withGitLock(wt, () => git(wt, ["push"]));
}

/** Fetch from all remotes for a session. */
export async function gitFetch(id: string): Promise<string> {
  const wt = sessionPath(id);

  return withGitLock(wt, () => git(wt, ["fetch", "--all"]));
}

/** Stash working directory changes in a session. */
export async function gitStash(id: string): Promise<string> {
  const wt = sessionPath(id);

  return withGitLock(wt, () => git(wt, ["stash"]));
}

export interface GitStashSaveOptions {
  includeUntracked?: boolean;
  keepIndex?: boolean;
  message?: string;
  /** Restrict the stash to these pathspecs (`git stash push -- <paths>`). */
  paths?: string[];
}

/**
 * Stash working directory changes with optional message and flags.
 *
 * Maps to `git stash push [-m <msg>] [-u] [--keep-index] [-- <paths>]`.
 */
export async function gitStashSave(
  id: string,
  options: GitStashSaveOptions = {},
): Promise<string> {
  const wt = sessionPath(id);
  const args: string[] = ["stash", "push"];
  if (options.includeUntracked) {
    args.push("-u");
  }
  if (options.keepIndex) {
    args.push("--keep-index");
  }
  const trimmed = options.message?.trim();
  if (trimmed) {
    args.push("-m", trimmed);
  }
  if (options.paths && options.paths.length > 0) {
    args.push("--", ...options.paths);
  }

  return withGitLock(wt, () => git(wt, args));
}

/**
 * Create a new branch from a stash entry.
 *
 * Maps to `git stash branch <name> <ref>`. On success, the stash is dropped
 * automatically by git.
 */
export async function gitStashBranch(
  id: string,
  stashRef: string,
  branchName: string,
): Promise<string> {
  const wt = sessionPath(id);

  return withGitLock(wt, () =>
    git(wt, ["stash", "branch", branchName, stashRef]),
  );
}

/** Pop the most recent stash in a session. */
export async function gitStashPop(id: string): Promise<string> {
  const wt = sessionPath(id);

  return withGitLock(wt, () => git(wt, ["stash", "pop"]));
}

/** Apply a specific stash by index without removing it. */
export async function gitStashApply(
  id: string,
  stashIndex: number,
): Promise<string> {
  const wt = sessionPath(id);

  return withGitLock(wt, () =>
    git(wt, ["stash", "apply", `stash@{${stashIndex}}`]),
  );
}

/**
 * Restore one or more paths from a ref (commit hash, `stash@{N}`, etc.) into
 * the working tree. Equivalent to `git checkout <ref> -- <paths>`. Used by the
 * working-copy drop targets to apply individual files from a stash or a
 * historical commit. Updates the index for the given paths as well.
 */
export async function gitCheckoutPaths(
  id: string,
  ref: string,
  paths: string[],
): Promise<string> {
  if (paths.length === 0) {
    return "";
  }
  const wt = sessionPath(id);

  return withGitLock(wt, () => git(wt, ["checkout", ref, "--", ...paths]));
}

/** Drop a specific stash by index. */
export async function gitStashDrop(
  id: string,
  stashIndex: number,
): Promise<string> {
  const wt = sessionPath(id);

  return withGitLock(wt, () =>
    git(wt, ["stash", "drop", `stash@{${stashIndex}}`]),
  );
}

// ---------------------------------------------------------------------------
// watch_session / unwatch_session / pause_all_watchers / resume_all_watchers
// ---------------------------------------------------------------------------

/**
 * Start watching a session directory for file system changes.
 *
 * Emits `session:diff-changed:{id}` with `DiffStats` whenever tracked files
 * change (debounced to ~1 second). Also emits the current stats immediately.
 *
 * If a watcher is already active for this session, this is a no-op.
 */
export function watchSession(id: string): void {
  const existing = appState.watchers.get(id);
  if (existing) {
    // Re-emit current stats for newly mounted listeners.
    existing.emitCurrent();

    return;
  }

  const ws = appState.sessions.get(id);
  if (!ws) {
    throw `Session not found: ${id}`;
  }
  // Sessions still in `initializing` have no worktree on disk yet — `git`
  // calls would just spin up failing subprocesses every poll. Callers
  // re-invoke this once the session flips to `ready`.
  if (!ws.path) {
    return;
  }

  const handle: WatcherHandle = startWatcher(id, ws.path);
  appState.watchers.set(id, handle);

  // Also attach the git-status FS watcher (idempotent — safe to call again).
  attachGitWatcher(id, ws.path).catch(() => {
    // Non-fatal — gitWatcher module already logs.
  });
}

/** Stop watching a session directory for file system changes. */
export function unwatchSession(id: string): void {
  const handle = appState.watchers.get(id);
  if (handle) {
    handle.stop();
    appState.watchers.delete(id);
    info(`Stopped file watcher for session ${id}`);
  }
  // The git-status watcher is owned by gitWatcher's internal map; we
  // intentionally do NOT detach it here — the diff-stats watcher's lifecycle
  // is per-mounted-consumer, but the git watcher should live as long as the
  // session does, so consumers of useGitStatus don't have to coordinate.
  // Detach happens in deleteSession / removeRepoRoot.
}

/** Pause all active file watchers (skip diff computation while window is unfocused). */
export function pauseAllWatchers(): void {
  for (const handle of appState.watchers.values()) {
    handle.pause();
  }
  info(`Paused all file watchers (${appState.watchers.size} active)`);
}

/** Resume all active file watchers (recompute diffs when window regains focus). */
export function resumeAllWatchers(): void {
  for (const handle of appState.watchers.values()) {
    handle.resume();
  }
  info(`Resumed all file watchers (${appState.watchers.size} active)`);
}

// ---------------------------------------------------------------------------
// read_argus_config / write_argus_config
// ---------------------------------------------------------------------------

/**
 * Read and parse the `.argus.json` configuration from the given repo root.
 *
 * Returns the default (empty) config if the file does not exist.
 */
export function readArgusConfig(repoRoot: string): ArgusConfig {
  try {
    return loadArgusConfig(repoRoot);
  } catch {
    return defaultArgusConfig();
  }
}

/**
 * Write a `.argus.json` configuration file to the given repo root.
 * Validates that the content is valid JSON before writing.
 */
export function writeArgusConfig(repoRoot: string, content: string): void {
  // Validate JSON before writing.
  try {
    JSON.parse(content);
  } catch (e) {
    throw `Invalid JSON: ${e}`;
  }
  const filePath = `${repoRoot}/.argus.json`;
  fs.writeFileSync(filePath, content, "utf8");
  info(`Wrote .argus.json to ${filePath}`);
  emitHostEvent("argus_config:changed", { repoRoot });
}

// ---------------------------------------------------------------------------
// set_session_base_branch / get_session_conflicts / merge_session_into_base
// ---------------------------------------------------------------------------

/** Update the base branch for a session (persisted to metadata). */
export async function setSessionBaseBranch(
  id: string,
  baseBranch: string,
): Promise<void> {
  const ws = appState.sessions.get(id);
  if (!ws) {
    throw `Session not found: ${id}`;
  }

  // Reject remote-qualified names like `origin/main`. The merge path runs
  // `git branch -f <base>`, which would silently create a bogus local branch
  // with a `/` in its name instead of moving the real local base.
  if (await isRemoteOnlyRef(ws.repo_root, baseBranch)) {
    const stripped = baseBranch.split("/").slice(1).join("/");
    throw `"${baseBranch}" is a remote-tracking ref, not a local branch. Use "${stripped}" instead.`;
  }

  ws.base_branch = baseBranch;
  appState.sessions.set(id, ws);

  // Persist to metadata file.
  const worktreesDir = worktreesRoot(ws.repo_root);
  const meta = loadMetadata(worktreesDir);
  const m = meta.get(ws.path);
  if (m) {
    m.base_branch = baseBranch;
    meta.set(ws.path, m);
  }
  try {
    saveMetadata(worktreesDir, meta);
  } catch {
    // Non-fatal.
  }
}

/**
 * Pin this session's agents and terminals to a Claude account, or pass `null`
 * to follow the app-wide active account. Takes effect on the next spawn;
 * running agents keep the account they started with.
 */
export function setSessionClaudeAccount(
  id: string,
  accountId: string | null,
): void {
  const ws = appState.sessions.get(id);
  if (!ws) {
    throw `Session not found: ${id}`;
  }
  if (accountId && !listClaudeAccounts().some((a) => a.id === accountId)) {
    throw `Unknown Claude account: ${accountId}`;
  }

  ws.claude_account_id = accountId;
  appState.sessions.set(id, ws);

  const worktreesDir = worktreesRoot(ws.repo_root);
  const meta = loadMetadata(worktreesDir);
  const m = meta.get(ws.path);
  if (m) {
    m.claude_account_id = accountId;
    meta.set(ws.path, m);
  }
  try {
    saveMetadata(worktreesDir, meta);
  } catch {
    // Non-fatal.
  }
}

/**
 * Return a list of files that would conflict merging this session into its
 * base branch. Returns an empty array if no conflicts or no base branch set.
 */
export async function getSessionConflicts(id: string): Promise<string[]> {
  const ws = appState.sessions.get(id);
  if (!ws) {
    throw `Session not found: ${id}`;
  }
  if (!ws.base_branch) {
    return [];
  }
  // Pending sessions don't have a branch or worktree yet — there's nothing
  // to compare against the base.
  if (!ws.branch || !ws.path) {
    return [];
  }

  return checkMergeConflicts(ws.repo_root, ws.branch, ws.base_branch, ws.path);
}

/**
 * Return files in the base branch's worktree that have uncommitted changes
 * AND would be modified by fast-forwarding the session's commits in. These
 * are the files git would refuse the merge on with "your local changes
 * would be overwritten by merge".
 *
 * Returns an empty array when:
 * - the session has no base branch
 * - the base branch isn't checked out in any worktree (we update the ref
 *   directly in that case, no working tree is touched)
 * - the base worktree is clean
 * - none of the base worktree's dirty files overlap with the merge diff
 */
export async function getSessionMergeBlockers(id: string): Promise<string[]> {
  const ws = appState.sessions.get(id);
  if (!ws) {
    throw `Session not found: ${id}`;
  }
  if (ws.kind === "project_root" || !ws.base_branch || !ws.branch || !ws.path) {
    return [];
  }

  // Locate the worktree currently holding the base branch — only that path
  // gets a real `git merge --ff-only` invocation.
  const wtRaw = await git(ws.repo_root, ["worktree", "list", "--porcelain"]);
  const fullRef = `refs/heads/${ws.base_branch}`;
  let basePath: string | null = null;
  let currentPath: string | null = null;
  for (const line of wtRaw.split("\n")) {
    if (line.startsWith("worktree ")) {
      currentPath = line.slice("worktree ".length).trim();
    } else if (line.startsWith("branch ")) {
      const ref = line.slice("branch ".length).trim();
      if (ref === fullRef && currentPath) {
        basePath = currentPath;
        break;
      }
    } else if (line === "") {
      currentPath = null;
    }
  }
  if (!basePath) {
    return [];
  }

  // Files that the merge would touch. `name-only` walks the diff between
  // base tip and session tip — exactly the set git checks dirty entries
  // against when refusing the ff merge.
  let mergedFilesRaw: string;
  try {
    mergedFilesRaw = await git(basePath, [
      "diff",
      "--name-only",
      `${ws.base_branch}..${ws.branch}`,
    ]);
  } catch {
    return [];
  }
  const mergedFiles = new Set(
    mergedFilesRaw
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean),
  );
  if (mergedFiles.size === 0) {
    return [];
  }

  // Dirty entries in the base worktree (staged, unstaged, or untracked).
  let statusRaw: string;
  try {
    statusRaw = await git(basePath, ["status", "--porcelain=v1"]);
  } catch {
    return [];
  }
  const dirty: string[] = [];
  for (const line of statusRaw.split("\n")) {
    if (line.length < 4) {
      continue;
    }
    // Porcelain v1: XY<space>path  (path may include rename "old -> new").
    const path = line.slice(3).split(" -> ").pop()?.trim();
    if (path) {
      dirty.push(path);
    }
  }

  return dirty.filter((p) => mergedFiles.has(p)).sort();
}

/** Merge session's branch into its base branch. */
export async function mergeSessionIntoBase(id: string): Promise<void> {
  const ws = appState.sessions.get(id);
  if (!ws) {
    throw `Session not found: ${id}`;
  }
  if (!ws.base_branch) {
    throw "No base branch set for this session";
  }
  if (isBranchProtected(ws.repo_root, ws.base_branch)) {
    throw (
      `'${ws.base_branch}' is a protected branch. ` +
      `Push this workspace's branch and open a pull request instead.`
    );
  }

  await withGitLock(ws.path, () =>
    doMergeSessionIntoBase(ws.repo_root, ws.path, ws.branch, ws.base_branch!),
  );

  emitHostEvent("session:merged", {
    sessionId: id,
    branch: ws.branch,
    baseBranch: ws.base_branch,
  });
}

/** Resumable-merge entrypoint: attempt rebase, leaving worktree paused on conflict. */
export async function attemptSessionMerge(id: string) {
  const ws = appState.sessions.get(id);
  if (!ws) {
    throw `Session not found: ${id}`;
  }
  if (!ws.base_branch || !ws.branch) {
    throw "No base branch set for this session";
  }
  if (isBranchProtected(ws.repo_root, ws.base_branch)) {
    throw (
      `'${ws.base_branch}' is a protected branch. ` +
      `Push this workspace's branch and open a pull request instead.`
    );
  }

  const result = await doAttemptMergeSession(
    ws.repo_root,
    ws.path,
    ws.branch,
    ws.base_branch,
  );

  if (result.state === "merged") {
    emitHostEvent("session:merged", {
      sessionId: id,
      branch: ws.branch,
      baseBranch: ws.base_branch,
    });
  }

  return result;
}

/** Continue an in-progress session merge after the orchestrator wrote resolutions. */
export async function continueSessionMerge(id: string) {
  const ws = appState.sessions.get(id);
  if (!ws) {
    throw `Session not found: ${id}`;
  }
  if (!ws.base_branch || !ws.branch) {
    throw "No base branch set for this session";
  }
  const result = await doContinueSessionMerge(
    ws.repo_root,
    ws.path,
    ws.branch,
    ws.base_branch,
  );

  if (result.state === "merged") {
    emitHostEvent("session:merged", {
      sessionId: id,
      branch: ws.branch,
      baseBranch: ws.base_branch,
    });
  }

  return result;
}

/** Abort an in-progress merge or rebase, restoring the worktree to a clean state. */
export async function abortSessionMerge(id: string): Promise<void> {
  const ws = appState.sessions.get(id);
  if (!ws) {
    throw `Session not found: ${id}`;
  }
  await doAbortSessionMerge(ws.path);
}

/** Comprehensive merge-readiness report for a session. */
export async function getSessionMergeStatus(
  id: string,
): Promise<SessionMergeStatus> {
  const ws = appState.sessions.get(id);
  if (!ws) {
    throw `Session not found: ${id}`;
  }

  return doGetSessionMergeStatus(
    ws.repo_root,
    ws.path,
    ws.branch ?? "",
    ws.base_branch ?? null,
  );
}

/**
 * Write `content` to a file inside a session's worktree. Creates parent
 * directories as needed. Refuses paths that resolve outside the worktree.
 * When `stage` is true, runs `git add` so the change lands in the index —
 * used for the merge-conflict-resolution flow where the orchestrator wants
 * its write picked up by `git rebase --continue`.
 */
export async function writeSessionFile(
  id: string,
  filePath: string,
  content: string,
  stage: boolean,
): Promise<{ bytes_written: number; resolved_path: string }> {
  const ws = appState.sessions.get(id);
  if (!ws) {
    throw `Session not found: ${id}`;
  }

  const wtRoot = nodePath.resolve(ws.path);
  const abs = nodePath.isAbsolute(filePath)
    ? nodePath.resolve(filePath)
    : nodePath.resolve(wtRoot, filePath);
  const rel = nodePath.relative(wtRoot, abs);
  if (rel.startsWith("..") || nodePath.isAbsolute(rel)) {
    throw `Refusing to write outside session worktree: ${filePath}`;
  }

  fs.mkdirSync(nodePath.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content, "utf8");

  if (stage) {
    await git(ws.path, ["add", "--", rel]);
  }

  return {
    bytes_written: Buffer.byteLength(content, "utf8"),
    resolved_path: rel,
  };
}

/**
 * Count commits on the session branch that are not yet in its base branch.
 * Returns 0 for sessions without a base branch, for the repo_root session,
 * or when the branches cannot be compared.
 */
export async function getSessionCommitsAhead(id: string): Promise<number> {
  const ws = appState.sessions.get(id);
  if (!ws) {
    throw `Session not found: ${id}`;
  }
  if (ws.kind === "project_root" || !ws.base_branch) {
    return 0;
  }
  try {
    const out = await git(ws.repo_root, [
      "rev-list",
      "--count",
      `${ws.base_branch}..${ws.branch}`,
    ]);
    const n = parseInt(out.trim(), 10);

    return Number.isFinite(n) ? n : 0;
  } catch {
    return 0;
  }
}

/**
 * Count commits on the base branch that are not yet in the session branch.
 * Returns 0 for sessions without a base branch, for the repo_root session,
 * or when the branches cannot be compared. > 0 means the session is out of
 * date and would benefit from a rebase onto the base.
 */
export async function getSessionCommitsBehind(id: string): Promise<number> {
  const ws = appState.sessions.get(id);
  if (!ws) {
    throw `Session not found: ${id}`;
  }
  if (ws.kind === "project_root" || !ws.base_branch) {
    return 0;
  }
  try {
    const out = await git(ws.repo_root, [
      "rev-list",
      "--count",
      `${ws.branch}..${ws.base_branch}`,
    ]);
    const n = parseInt(out.trim(), 10);

    return Number.isFinite(n) ? n : 0;
  } catch {
    return 0;
  }
}

/**
 * Rebase the session branch onto its base branch, pulling in any new commits
 * from the base without merging session commits back. Useful to keep a
 * long-running session up to date.
 */
export async function rebaseSessionOnBase(id: string): Promise<void> {
  const ws = appState.sessions.get(id);
  if (!ws) {
    throw `Session not found: ${id}`;
  }
  if (ws.kind === "project_root" || !ws.base_branch) {
    throw "No base branch set for this session";
  }

  await withGitLock(ws.path, () =>
    doRebaseSessionOnBase(ws.path, ws.branch ?? "", ws.base_branch!),
  );
}

// ---------------------------------------------------------------------------
// push_workspace_branch
// ---------------------------------------------------------------------------

/**
 * Push the workspace's feature branch to its remote and return a URL that
 * opens a pull-request compare page against the base branch. Supports GitHub
 * remotes (SSH and HTTPS); for other hosts, returns `null` for `prUrl` and
 * the caller can fall back to opening the plain repo URL.
 *
 * Commits any staged changes in the workspace first, so the pushed branch
 * reflects the latest agent-staged work. Uses `-u` to track the remote.
 */
export async function pushSessionBranch(id: string): Promise<{
  branch: string;
  prUrl: string | null;
  remoteName: string;
}> {
  const ws = appState.sessions.get(id);
  if (!ws) {
    throw `Session not found: ${id}`;
  }
  if (ws.kind !== "worktree") {
    throw `Cannot push a ${ws.kind} session`;
  }

  // Prefer `origin`; fall back to the first configured remote.
  const remoteList = (await git(ws.repo_root, ["remote"]))
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);
  if (remoteList.length === 0) {
    throw "No git remote configured for this repository";
  }
  const remoteName = remoteList.includes("origin") ? "origin" : remoteList[0];

  await withGitLock(ws.path, async () => {
    // Commit staged changes first, so the push is meaningful.
    try {
      await git(ws.path, ["diff", "--cached", "--quiet"]);
    } catch {
      await git(ws.path, ["commit", "-m", `chore: wip on ${ws.branch}`]);
    }
    await git(ws.path, ["push", "-u", remoteName, ws.branch]);
  });

  const remoteUrl = (
    await git(ws.repo_root, ["remote", "get-url", remoteName])
  ).trim();

  // Honor the project's pull-request template so the PR form opens
  // prefilled. For repos with multiple templates in
  // `.github/PULL_REQUEST_TEMPLATE/`, GitHub requires `?template=<file>` —
  // without it the PR body opens blank. Single top-level templates are
  // auto-detected by GitHub from `?expand=1` alone.
  const template = pickPullRequestTemplate(ws.repo_root);
  const prUrl = buildPullRequestUrl(
    remoteUrl,
    ws.branch,
    ws.base_branch ?? null,
    template,
  );

  return { branch: ws.branch, prUrl, remoteName };
}

// Re-exported so existing imports keep working — see `./pullRequest.ts`.
export { buildPullRequestUrl } from "./pullRequest";
