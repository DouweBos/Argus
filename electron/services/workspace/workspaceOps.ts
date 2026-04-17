/**
 * IPC-facing workspace operation functions: diff, status, config, branches,
 * file watching, and merge.
 *
 * Each function looks up the workspace from `appState.workspaces` and
 * delegates to the lower-level modules.
 */

import { execFile } from "node:child_process";
import fs from "node:fs";
import { info } from "../../../app/lib/logger";
import { appState } from "../../state";
import { git, worktreesRoot } from "./git";
import {
  checkMergeConflicts,
  mergeWorkspaceIntoBase as doMergeWorkspaceIntoBase,
} from "./merge";
import { loadMetadata, saveMetadata } from "./metadata";
import { defaultArgusConfig, type ArgusConfig } from "./models";
import { loadArgusConfig } from "./setup";
import { startWatcher, type WatcherHandle } from "./watcher";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Look up a workspace's path by ID, or throw. */
function workspacePath(id: string): string {
  const ws = appState.workspaces.get(id);
  if (!ws) {
    throw `Workspace not found: ${id}`;
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
    .map((l) => l.replace(/^\*\s+/, "").trim())
    .filter((b) => b.length > 0)
    .sort();
}

export interface BranchList {
  local: string[];
  remote: string[];
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
  const remote = remoteRaw
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.startsWith("origin/"))
    .map((l) => l.slice("origin/".length))
    .filter((l) => l.length > 0 && l !== "HEAD")
    .filter((l) => !localSet.has(l))
    .sort();

  return { local, remote };
}

/** Checkout an existing local branch in the repo root. */
export async function checkoutBranch(
  repoRoot: string,
  branch: string,
): Promise<void> {
  await git(repoRoot, ["checkout", branch]);
}

// ---------------------------------------------------------------------------
// get_workspace_diff / get_workspace_full_diff / get_workspace_staged_diff /
// get_workspace_untracked_diff / get_workspace_status
// ---------------------------------------------------------------------------

/** Return `git diff` output (unstaged changes) for a workspace. */
export async function getWorkspaceDiff(id: string): Promise<string> {
  return git(workspacePath(id), ["diff"]);
}

/** Return `git diff HEAD` output (staged + unstaged vs HEAD) for a workspace. */
export async function getWorkspaceFullDiff(id: string): Promise<string> {
  return git(workspacePath(id), ["diff", "HEAD"]);
}

/** Return `git diff --cached` output (staged only) for a workspace. */
export async function getWorkspaceStagedDiff(id: string): Promise<string> {
  return git(workspacePath(id), ["diff", "--cached"]);
}

/**
 * Return untracked files as synthetic unified diff output for a workspace.
 *
 * Uses `git ls-files --others --exclude-standard` then reads each file and
 * formats it as a unified diff.
 */
export async function getWorkspaceUntrackedDiff(id: string): Promise<string> {
  const wtPath = workspacePath(id);
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

/** Return `git status --short` output for a workspace. */
export async function getWorkspaceStatus(id: string): Promise<string> {
  return git(workspacePath(id), ["status", "--short"]);
}

// ---------------------------------------------------------------------------
// stage_file / unstage_file / discard_file
// ---------------------------------------------------------------------------

/** Stage an entire file in a workspace. */
export async function stageFile(id: string, filePath: string): Promise<void> {
  await git(workspacePath(id), ["add", "--", filePath]);
}

/** Unstage an entire file (reset to HEAD) in a workspace. */
export async function unstageFile(id: string, filePath: string): Promise<void> {
  await git(workspacePath(id), ["reset", "HEAD", "--", filePath]);
}

/**
 * Stage all changes in the workspace tree in one `git add -A`.
 * Avoids hundreds of sequential `git add -- <path>` calls that contend for
 * `.git/index.lock` with each other and with the diff watcher’s polling.
 */
export async function stageAll(id: string): Promise<void> {
  await git(workspacePath(id), ["add", "-A"]);
}

/** Unstage all index entries in one `git reset HEAD`. */
export async function unstageAll(id: string): Promise<void> {
  await git(workspacePath(id), ["reset", "HEAD"]);
}

/**
 * Discard all changes to a tracked file (checkout from HEAD).
 * For untracked files, removes them from disk.
 */
export async function discardFile(id: string, filePath: string): Promise<void> {
  const wtPath = workspacePath(id);
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

/** Stage a hunk (patch string) in a workspace. */
export async function stageHunk(id: string, patch: string): Promise<void> {
  await applyPatch(workspacePath(id), patch, ["--cached"]);
}

/** Unstage a hunk (patch string) in a workspace. */
export async function unstageHunk(id: string, patch: string): Promise<void> {
  await applyPatch(workspacePath(id), patch, ["--cached", "--reverse"]);
}

/** Discard a hunk (reverse-apply patch) in a workspace. */
export async function discardHunk(id: string, patch: string): Promise<void> {
  await applyPatch(workspacePath(id), patch, ["--reverse"]);
}

// ---------------------------------------------------------------------------
// git_commit / get_git_author / get_last_commit_message / get_last_commit_hash
// ---------------------------------------------------------------------------

/**
 * Commit staged changes in a workspace.
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

  return git(workspacePath(id), args);
}

/** Return the git author `[name, email]` configured for a workspace. */
export async function getGitAuthor(id: string): Promise<[string, string]> {
  const wtPath = workspacePath(id);
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

/** Return the full commit message of the most recent commit in a workspace. */
export async function getLastCommitMessage(id: string): Promise<string> {
  return (await git(workspacePath(id), ["log", "-1", "--format=%B"])).trim();
}

/** Return the abbreviated hash of the most recent commit in a workspace. */
export async function getLastCommitHash(id: string): Promise<string> {
  return (await git(workspacePath(id), ["log", "-1", "--format=%h"])).trim();
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
  ].join("%n");
  const args = [
    "log",
    "--date-order",
    `--format=${format}${COMMIT_SEP}`,
    `-${count}`,
  ];
  if (allBranches) {
    args.splice(1, 0, "--all");
  }
  const raw = await git(workspacePath(id), args);
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
    };
  });
}

/** Return the diff for a specific commit. */
export async function gitShowCommit(
  id: string,
  commitHash: string,
): Promise<string> {
  return git(workspacePath(id), [
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
  const raw = await git(workspacePath(id), [
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
  return git(workspacePath(id), [
    "stash",
    "show",
    "-p",
    `stash@{${stashIndex}}`,
  ]);
}

// ---------------------------------------------------------------------------
// git_pull / git_push / git_fetch / git_stash / git_stash_pop
// ---------------------------------------------------------------------------

/** Pull from the remote for a workspace. Optionally from a specific branch, with rebase. */
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

  return git(workspacePath(id), args);
}

/** Push to the remote for a workspace. */
export async function gitPush(id: string): Promise<string> {
  return git(workspacePath(id), ["push"]);
}

/** Fetch from all remotes for a workspace. */
export async function gitFetch(id: string): Promise<string> {
  return git(workspacePath(id), ["fetch", "--all"]);
}

/** Stash working directory changes in a workspace. */
export async function gitStash(id: string): Promise<string> {
  return git(workspacePath(id), ["stash"]);
}

/** Pop the most recent stash in a workspace. */
export async function gitStashPop(id: string): Promise<string> {
  return git(workspacePath(id), ["stash", "pop"]);
}

/** Apply a specific stash by index without removing it. */
export async function gitStashApply(
  id: string,
  stashIndex: number,
): Promise<string> {
  return git(workspacePath(id), ["stash", "apply", `stash@{${stashIndex}}`]);
}

/** Drop a specific stash by index. */
export async function gitStashDrop(
  id: string,
  stashIndex: number,
): Promise<string> {
  return git(workspacePath(id), ["stash", "drop", `stash@{${stashIndex}}`]);
}

// ---------------------------------------------------------------------------
// watch_workspace / unwatch_workspace / pause_all_watchers / resume_all_watchers
// ---------------------------------------------------------------------------

/**
 * Start watching a workspace directory for file system changes.
 *
 * Emits `workspace:diff-changed:{id}` with `DiffStats` whenever tracked files
 * change (debounced to ~1 second). Also emits the current stats immediately.
 *
 * If a watcher is already active for this workspace, this is a no-op.
 */
export function watchWorkspace(id: string): void {
  const existing = appState.watchers.get(id);
  if (existing) {
    // Re-emit current stats for newly mounted listeners.
    existing.emitCurrent();

    return;
  }

  const wtPath = workspacePath(id);
  const handle: WatcherHandle = startWatcher(id, wtPath);
  appState.watchers.set(id, handle);
}

/** Stop watching a workspace directory for file system changes. */
export function unwatchWorkspace(id: string): void {
  const handle = appState.watchers.get(id);
  if (handle) {
    handle.stop();
    appState.watchers.delete(id);
    info(`Stopped file watcher for workspace ${id}`);
  }
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
}

// ---------------------------------------------------------------------------
// set_workspace_base_branch / get_workspace_conflicts / merge_workspace_into_base
// ---------------------------------------------------------------------------

/** Update the base branch for a workspace (persisted to metadata). */
export function setWorkspaceBaseBranch(id: string, baseBranch: string): void {
  const ws = appState.workspaces.get(id);
  if (!ws) {
    throw `Workspace not found: ${id}`;
  }

  ws.base_branch = baseBranch;
  appState.workspaces.set(id, ws);

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
 * Return a list of files that would conflict merging this workspace into its
 * base branch. Returns an empty array if no conflicts or no base branch set.
 */
export async function getWorkspaceConflicts(id: string): Promise<string[]> {
  const ws = appState.workspaces.get(id);
  if (!ws) {
    throw `Workspace not found: ${id}`;
  }
  if (!ws.base_branch) {
    return [];
  }

  return checkMergeConflicts(ws.repo_root, ws.branch, ws.base_branch);
}

/** Merge workspace's branch into its base branch. */
export async function mergeWorkspaceIntoBase(id: string): Promise<void> {
  const ws = appState.workspaces.get(id);
  if (!ws) {
    throw `Workspace not found: ${id}`;
  }
  if (!ws.base_branch) {
    throw "No base branch set for this workspace";
  }

  await doMergeWorkspaceIntoBase(ws.repo_root, ws.branch, ws.base_branch);
}
