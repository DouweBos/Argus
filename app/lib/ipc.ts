/**
 * Typed IPC wrappers for all Electron backend commands.
 *
 * All renderer → main communication goes through these functions.
 * Components should never call `window.argus.invoke()` directly.
 */

import type {
  ChatHistoryEntry,
  ChatHistorySearchResult,
  SavedConversation,
} from "./chatHistory";
import type {
  AgentStatus,
  AndroidDevice,
  ArgusConfig,
  ArgusConfigSuggestion,
  BranchList,
  ClaudeAccountsState,
  ClaudeAuthStatus,
  ConductorLogEntry,
  DependencyReport,
  DeviceInfo,
  DevicePlatform,
  DirEntry,
  ExampleProject,
  FileStat,
  GitStatus,
  InterestingPullRequest,
  MentionPathResult,
  PullRequestDetail,
  ReleaseNoteEntry,
  ReleaseNotePatternConfig,
  SessionReleaseNotesResult,
  OnboardingConfigFile,
  OnboardingStep,
  OrgTask,
  Organization,
  OrganizationMember,
  PrereqId,
  PrereqResult,
  ProjectEntry,
  SimulatorDevice,
  AppSettings,
  InheritedMcpServer,
  McpOAuthStatus,
  McpTestResult,
  RegisteredRunner,
  RemoteDevice,
  RemotePairingStart,
  RemoteStatus,
  RunnerOnboardingStep,
  Session,
  UserProjectSettings,
} from "./types";
import { rehydrateGitError } from "./gitError";

declare global {
  interface Window {
    argus: {
      getFilePath: (file: File) => string;
      invoke: <T>(
        channel: string,
        args?: Record<string, unknown>,
      ) => Promise<T>;
      on: <T>(event: string, callback: (payload: T) => void) => () => void;
      send: (channel: string, args?: Record<string, unknown>) => void;
      setZoomFactor: (factor: number) => void;
    };
  }
}

function invoke<T>(
  channel: string,
  args?: Record<string, unknown>,
): Promise<T> {
  return window.argus.invoke<T>(channel, args).catch((err) => {
    // Rehydrate structured GitError payloads — the main process attaches
    // the `__gitError` envelope as own props on the thrown Error so it
    // survives Electron's IPC error serialisation.
    const gitErr = rehydrateGitError(err);
    if (gitErr) {
      throw gitErr;
    }
    throw err;
  });
}

/** Fire-and-forget IPC — skips the invoke reply round-trip. */
export function send(channel: string, args?: Record<string, unknown>): void {
  window.argus.send(channel, args);
}

// Window
export const closeWindow = (): Promise<void> => invoke("close_window");

// Quit-with-running-agents flow.
export const appConfirmQuit = (): Promise<void> => invoke("app_confirm_quit");
export const appCancelQuit = (): Promise<void> => invoke("app_cancel_quit");

export interface QuitRequestPayload {
  runningCount: number;
}

// GitHub PR discovery
export const listInterestingPullRequests = (
  repoRoots: string[],
): Promise<InterestingPullRequest[]> =>
  invoke("list_interesting_pull_requests", { repoRoots });

export const getPullRequestDetail = (
  owner: string,
  repo: string,
  number: number,
): Promise<PullRequestDetail> =>
  invoke("get_pull_request_detail", { owner, repo, number });

export const getPullRequestDiff = (
  owner: string,
  repo: string,
  number: number,
): Promise<string> => invoke("get_pull_request_diff", { owner, repo, number });

// GitHub PR write actions
export type MergeStrategy = "merge" | "rebase" | "squash";

export const readPrTemplate = (repoRoot: string): Promise<string | null> =>
  invoke("read_pr_template", { repoRoot });

export const autofillPrTemplate = (params: {
  baseBranch: string;
  sessionId: string;
  title: string;
}): Promise<string | null> => invoke("autofill_pr_template", params);

export const ghPrCreate = (params: {
  base: string;
  body: string;
  draft: boolean;
  head: string;
  repoRoot: string;
  title: string;
}): Promise<{ number: number; url: string }> => invoke("gh_pr_create", params);

export const ghPrComment = (params: {
  body: string;
  number: number;
  owner: string;
  repo: string;
}): Promise<void> => invoke("gh_pr_comment", params);

export const ghPrMerge = (params: {
  number: number;
  owner: string;
  repo: string;
  strategy: MergeStrategy;
}): Promise<void> => invoke("gh_pr_merge", params);

export const ghPrClose = (params: {
  number: number;
  owner: string;
  repo: string;
}): Promise<void> => invoke("gh_pr_close", params);

// Session commands
export const addRepoRoot = (path: string): Promise<void> =>
  invoke("add_repo_root", { path });

export const removeRepoRoot = (path: string): Promise<void> =>
  invoke("remove_repo_root", { path });

export const listProjects = (): Promise<ProjectEntry[]> =>
  invoke("list_projects");

export const showOpenDirectoryDialog = (
  title?: string,
): Promise<string | null> => invoke("show_open_dialog", { title });

export const getRepoBranch = (repoRoot: string): Promise<string> =>
  invoke("get_repo_branch", { repoRoot });

export const listBranches = (repoRoot: string): Promise<string[]> =>
  invoke("list_branches", { repoRoot });

export const listAllBranches = (repoRoot: string): Promise<BranchList> =>
  invoke("list_all_branches", { repoRoot });

export const checkoutBranch = (
  repoRoot: string,
  branch: string,
): Promise<void> => invoke("checkout_branch", { repoRoot, branch });

// ---------------------------------------------------------------------------
// Phase 6 P2 / P5 — project-root branch listing + ops
// ---------------------------------------------------------------------------

export interface BranchCommitSummary {
  author: string;
  hash: string;
  subject: string;
  timestamp: number;
}

export interface EnrichedBranch {
  ahead: number;
  behind: number;
  fullName: string;
  isCurrent: boolean;
  lastCommit: BranchCommitSummary | null;
  name: string;
  upstream: string | null;
}

export interface RemoteBranch {
  branchName: string;
  lastCommit: BranchCommitSummary | null;
  name: string;
  remote: string;
}

export const gitListLocalBranches = (
  sessionId: string,
): Promise<EnrichedBranch[]> =>
  invoke("git_list_local_branches", { id: sessionId });

export const gitListRemoteBranches = (
  sessionId: string,
): Promise<RemoteBranch[]> =>
  invoke("git_list_remote_branches", { id: sessionId });

export const gitCreateBranch = (
  sessionId: string,
  opts: { checkout?: boolean; name: string; startPoint?: string },
): Promise<void> => invoke("git_create_branch", { id: sessionId, ...opts });

export const gitDeleteBranch = (
  sessionId: string,
  opts: { force?: boolean; name: string },
): Promise<void> => invoke("git_delete_branch", { id: sessionId, ...opts });

export const gitRenameBranch = (
  sessionId: string,
  opts: { from: string; to: string },
): Promise<void> => invoke("git_rename_branch", { id: sessionId, ...opts });

export const gitCheckout = (
  sessionId: string,
  opts: { branch: string; create?: boolean },
): Promise<void> => invoke("git_checkout", { id: sessionId, ...opts });

export const gitSetUpstream = (
  sessionId: string,
  opts: { branch: string; upstream: string },
): Promise<void> => invoke("git_set_upstream", { id: sessionId, ...opts });

export const gitMergeBranch = (
  sessionId: string,
  opts: { from: string; into?: string; squash?: boolean },
): Promise<void> => invoke("git_merge_branch", { id: sessionId, ...opts });

export const gitRebaseOnto = (
  sessionId: string,
  opts: { branch?: string; upstream: string },
): Promise<void> => invoke("git_rebase_onto", { id: sessionId, ...opts });

// ---------------------------------------------------------------------------
// Phase 6B P7 — tags
// ---------------------------------------------------------------------------

export interface GitTag {
  commitHash: string;
  /** ISO-strict date the tag was created (annotated tag date or, for
   * lightweight tags, the target commit's committer date). */
  creatorDate: string;
  isAnnotated: boolean;
  message?: string;
  name: string;
  pushed: boolean | null;
  subject: string;
  tagger?: { date: string; email: string; name: string };
}

export const gitListTags = (sessionId: string): Promise<GitTag[]> =>
  invoke("git_list_tags", { id: sessionId });

export const gitCreateTag = (
  sessionId: string,
  opts: {
    force?: boolean;
    message?: string;
    name: string;
    ref?: string;
    sign?: boolean;
  },
): Promise<void> => invoke("git_create_tag", { id: sessionId, ...opts });

export const gitDeleteTag = (
  sessionId: string,
  opts: { name: string },
): Promise<void> => invoke("git_delete_tag", { id: sessionId, ...opts });

export const gitPushTag = (
  sessionId: string,
  opts: { all?: boolean; name?: string; remote?: string },
): Promise<void> => invoke("git_push_tag", { id: sessionId, ...opts });

// ---------------------------------------------------------------------------
// Phase 6B P8 — rich remotes
// ---------------------------------------------------------------------------

export type RemoteScheme = "https" | "other" | "ssh";

export interface GitRemoteRich {
  fetchUrl: string;
  host: string;
  name: string;
  pushUrl?: string;
  refs: number;
  scheme: RemoteScheme;
}

export const gitListRemotes = (sessionId: string): Promise<GitRemoteRich[]> =>
  invoke("git_list_remotes", { id: sessionId });

export const gitAddRemote = (
  sessionId: string,
  opts: { name: string; url: string },
): Promise<void> => invoke("git_add_remote", { id: sessionId, ...opts });

export const gitRemoveRemote = (
  sessionId: string,
  opts: { name: string },
): Promise<void> => invoke("git_remove_remote", { id: sessionId, ...opts });

export const gitRenameRemote = (
  sessionId: string,
  opts: { from: string; to: string },
): Promise<void> => invoke("git_rename_remote", { id: sessionId, ...opts });

export const gitSetRemoteUrl = (
  sessionId: string,
  opts: { name: string; push?: boolean; url: string },
): Promise<void> => invoke("git_set_remote_url", { id: sessionId, ...opts });

export const gitPruneRemote = (
  sessionId: string,
  opts: { name: string },
): Promise<void> => invoke("git_prune_remote", { id: sessionId, ...opts });

// ---------------------------------------------------------------------------
// Phase 6B P11 — push/pull v2
// ---------------------------------------------------------------------------

export interface PushV2Opts {
  branch?: string;
  force?: boolean;
  forceWithLease?: boolean;
  ref?: string;
  remote?: string;
  setUpstream?: boolean;
  tags?: "all" | "follow" | "none";
}

export const gitPushV2 = (
  sessionId: string,
  opts: PushV2Opts,
): Promise<string> => invoke("git_push_v2", { id: sessionId, ...opts });

export interface PullV2Opts {
  branch?: string;
  prune?: boolean;
  remote?: string;
  strategy: "ff-only" | "merge" | "rebase";
  tags?: boolean;
}

export const gitPullV2 = (
  sessionId: string,
  opts: PullV2Opts,
): Promise<string> => invoke("git_pull_v2", { id: sessionId, ...opts });

// ---------------------------------------------------------------------------
// Phase 6B P12 — reset / revert / cherry-pick
// ---------------------------------------------------------------------------

export type ResetMode = "hard" | "mixed" | "soft";

export const gitReset = (
  sessionId: string,
  opts: { mode: ResetMode; ref: string },
): Promise<void> => invoke("git_reset", { id: sessionId, ...opts });

export const gitRevert = (
  sessionId: string,
  opts: { hash: string; noCommit?: boolean },
): Promise<void> => invoke("git_revert", { id: sessionId, ...opts });

export const gitCherryPick = (
  sessionId: string,
  opts: { hash: string[] | string; noCommit?: boolean },
): Promise<void> => invoke("git_cherry_pick", { id: sessionId, ...opts });

// ---------------------------------------------------------------------------
// Phase 6B P9 — submodules
// ---------------------------------------------------------------------------

export type SubmoduleStatus = "clean" | "modified" | "uninitialized";

export interface GitSubmodule {
  commitHash: string;
  name: string;
  path: string;
  status: SubmoduleStatus;
  url: string;
}

export const gitSubmoduleList = (sessionId: string): Promise<GitSubmodule[]> =>
  invoke("git_submodule_list", { id: sessionId });

export const gitSubmoduleInit = (
  sessionId: string,
  opts: { path?: string },
): Promise<void> => invoke("git_submodule_init", { id: sessionId, ...opts });

export const gitSubmoduleUpdate = (
  sessionId: string,
  opts: { path?: string; remote?: boolean },
): Promise<void> => invoke("git_submodule_update", { id: sessionId, ...opts });

export const gitSubmoduleDeinit = (
  sessionId: string,
  opts: { force?: boolean; path: string },
): Promise<void> => invoke("git_submodule_deinit", { id: sessionId, ...opts });

// ---------------------------------------------------------------------------
// Phase 6B P10 — worktrees (read-only)
// ---------------------------------------------------------------------------

export interface GitWorktree {
  branch: string | null;
  head: string;
  isDetached: boolean;
  isLocked: boolean;
  isMain: boolean;
  lockReason?: string;
  path: string;
}

export const gitWorktreeList = (sessionId: string): Promise<GitWorktree[]> =>
  invoke("git_worktree_list", { id: sessionId });

// ---------------------------------------------------------------------------
// Phase 7 T1/T2 — interactive rebase
// ---------------------------------------------------------------------------

export type RebaseAction =
  | "drop"
  | "edit"
  | "fixup"
  | "pick"
  | "reword"
  | "squash";

export interface RebasePlanCommit {
  author: string;
  hash: string;
  subject: string;
}

export interface RebasePlanEntry {
  action: RebaseAction;
  hash: string;
  newSubject?: string;
}

export const gitRebaseInteractivePlan = (
  sessionId: string,
  opts: { upstream: string },
): Promise<RebasePlanCommit[]> =>
  invoke("git_rebase_interactive_plan", { id: sessionId, ...opts });

export const gitRebaseInteractiveRun = (
  sessionId: string,
  opts: { plan: RebasePlanEntry[]; upstream: string },
): Promise<void> =>
  invoke("git_rebase_interactive_run", { id: sessionId, ...opts });

export const gitRebaseAutosquash = (
  sessionId: string,
  opts: { upstream: string },
): Promise<void> => invoke("git_rebase_autosquash", { id: sessionId, ...opts });

// ---------------------------------------------------------------------------
// Phase 7 T3 — bisect
// ---------------------------------------------------------------------------

export interface BisectStep {
  currentRef: string | null;
  currentSubject: string | null;
  finished: boolean;
  firstBadCommit?: { hash: string; subject: string };
  remaining: number | null;
}

export interface BisectStatus extends BisectStep {
  active: boolean;
}

export const gitBisectStart = (
  sessionId: string,
  opts: { badRef: string; goodRef: string },
): Promise<BisectStep> =>
  invoke("git_bisect_start", { id: sessionId, ...opts });

export const gitBisectGood = (sessionId: string): Promise<BisectStep> =>
  invoke("git_bisect_good", { id: sessionId });

export const gitBisectBad = (sessionId: string): Promise<BisectStep> =>
  invoke("git_bisect_bad", { id: sessionId });

export const gitBisectSkip = (sessionId: string): Promise<BisectStep> =>
  invoke("git_bisect_skip", { id: sessionId });

export const gitBisectReset = (sessionId: string): Promise<void> =>
  invoke("git_bisect_reset", { id: sessionId });

export const gitBisectStatus = (sessionId: string): Promise<BisectStatus> =>
  invoke("git_bisect_status", { id: sessionId });

// ---------------------------------------------------------------------------
// Phase 7 T5 — credential helpers
// ---------------------------------------------------------------------------

export type SshKeyType = "dsa" | "ecdsa" | "ed25519" | "other" | "rsa";

export interface SshKey {
  name: string;
  type: SshKeyType;
}

export const checkSshKeys = (): Promise<{ keys: SshKey[] }> =>
  invoke("check_ssh_keys");

export const getGlobalCredentialHelper = (): Promise<string | null> =>
  invoke("get_global_credential_helper");

export const setGlobalCredentialHelper = (
  name: "osxkeychain" | "store",
): Promise<void> => invoke("set_global_credential_helper", { name });

// ---------------------------------------------------------------------------
// Phase 7 T6 — LFS
// ---------------------------------------------------------------------------

export interface LfsFiles {
  lfsInstalled: boolean;
  /** True when the repo has tracked files matching `filter=lfs` attributes. */
  repoUsesLfs: boolean;
  tracked: string[];
}

export const gitLfsFiles = (sessionId: string): Promise<LfsFiles> =>
  invoke("git_lfs_files", { id: sessionId });

export const gitLfsPull = (
  sessionId: string,
  opts: { paths?: string[] },
): Promise<void> => invoke("git_lfs_pull", { id: sessionId, ...opts });

// ---------------------------------------------------------------------------
// Phase 7 T7 — patches
// ---------------------------------------------------------------------------

export interface FormatPatchResult {
  patchPaths: string[];
}

export const gitFormatPatch = (
  sessionId: string,
  opts: { outputDir?: string; range: string },
): Promise<FormatPatchResult> =>
  invoke("git_format_patch", { id: sessionId, ...opts });

export const gitAm = (
  sessionId: string,
  opts: { patchPaths: string[] },
): Promise<void> => invoke("git_am", { id: sessionId, ...opts });

// ---------------------------------------------------------------------------
// Phase 7 T8 — hooks
// ---------------------------------------------------------------------------

export interface HookOutput {
  exitCode: number;
  ranAt: number;
  stderr: string;
  stdout: string;
}

export interface Hook {
  executable: boolean;
  lastModified: number;
  lastOutput: HookOutput | null;
  name: string;
  path: string;
}

export const gitListHooks = (sessionId: string): Promise<Hook[]> =>
  invoke("git_list_hooks", { id: sessionId });

export const gitRunHook = (
  sessionId: string,
  opts: { name: string },
): Promise<HookOutput> => invoke("git_run_hook", { id: sessionId, ...opts });

export const listSessions = (repoRoot: string): Promise<Session[]> =>
  invoke("list_sessions", { repoRoot });

export interface CreateSessionLlmDefault {
  /** App-level default model id. `null` lets the runner pick. */
  model?: string | null;
  /** App-level default runner id (e.g. `"claude-code"`). `null` defers to fallback. */
  runner?: string | null;
}

export const createSession = (
  repoRoot: string,
  branch: string,
  description: string,
  useExistingBranch?: boolean,
  baseBranch?: string,
  appDefaultLlm?: CreateSessionLlmDefault,
): Promise<Session> =>
  invoke("create_session", {
    repoRoot,
    branch,
    description,
    useExistingBranch: useExistingBranch ?? false,
    baseBranch,
    appDefaultLlm,
  });

export const createHeadSession = (repoRoot: string): Promise<Session> =>
  invoke("create_project_root_session", { repoRoot });

export const deleteSession = (
  id: string,
  deleteBranch?: boolean,
): Promise<void> =>
  invoke("delete_session", {
    id,
    shouldDeleteBranch: deleteBranch ?? false,
  });

export const renameSession = (id: string, displayName: string): Promise<void> =>
  invoke("rename_session", { id, displayName });

export const renameSessionBranch = (
  id: string,
  branch: string,
): Promise<void> => invoke("rename_session_branch", { id, branch });

export const clearSessionSetupError = (id: string): Promise<void> =>
  invoke("clear_session_setup_error", { id });

export const retrySessionSetup = (id: string): Promise<void> =>
  invoke("retry_session_setup", { id });

export interface ForkSessionResult {
  claude_session_id: string | null;
  session: Session;
}

export type ForkReplayOp =
  | {
      content: string;
      filePath: string;
      timestampMs: number;
      type: "write";
    }
  | {
      edits: { newString: string; oldString: string; replaceAll?: boolean }[];
      filePath: string;
      timestampMs: number;
      type: "multiEdit";
    }
  | {
      filePath: string;
      newString: string;
      oldString: string;
      replaceAll?: boolean;
      timestampMs: number;
      type: "edit";
    };

export const forkSession = (
  sourceSessionId: string,
  branch: string,
  description: string,
  forkTimestampMs: number,
  forkTurnNumber: number,
  sourceClaudeSessionId?: string | null,
  replayOps?: ForkReplayOp[] | null,
): Promise<ForkSessionResult> =>
  invoke("fork_session", {
    sourceSessionId,
    branch,
    description,
    forkTimestampMs,
    forkTurnNumber,
    sourceClaudeSessionId: sourceClaudeSessionId ?? null,
    replayOps: replayOps ?? null,
  });

export const forkChatInSession = (
  sourceSessionId: string,
  sourceClaudeSessionId: string,
  forkTimestampMs: number,
  forkTurnNumber: number,
): Promise<{ claude_session_id: string | null }> =>
  invoke("fork_chat_in_session", {
    sourceSessionId,
    sourceClaudeSessionId,
    forkTimestampMs,
    forkTurnNumber,
  });

/**
 * Restore an agent's conversation in place — kills and respawns the child
 * under the same agentId. Returns the new Claude session UUID (or null for
 * a fresh-start when `keepTurnNumber === 0`).
 */
/** Snapshot the session worktree's files. Returned id is what `restoreCheckpoint` accepts. */
export const createCheckpoint = (
  sessionId: string,
): Promise<{
  createdAt: number;
  hasChanges: boolean;
  id: string;
  sha: string;
}> => invoke("create_checkpoint", { sessionId });

/** Revert the session worktree to a previously created checkpoint. */
export const restoreCheckpoint = (
  sessionId: string,
  checkpointId: string,
): Promise<void> => invoke("restore_checkpoint", { sessionId, checkpointId });

/** Drop a checkpoint ref. Best-effort. */
export const deleteCheckpoint = (
  sessionId: string,
  checkpointId: string,
): Promise<void> => invoke("delete_checkpoint", { sessionId, checkpointId });

export const restoreAgentAtTurn = (
  agentId: string,
  sourceClaudeSessionId: string,
  keepTurnNumber: number,
  cutoffTimestampMs: number,
): Promise<{ claude_session_id: string | null }> =>
  invoke("restore_agent_at_turn", {
    agentId,
    sourceClaudeSessionId,
    keepTurnNumber,
    cutoffTimestampMs,
  });

export const getSessionDiff = (id: string): Promise<string> =>
  invoke("get_session_diff", { id });

export const getSessionStatus = (id: string): Promise<string> =>
  invoke("get_session_status", { id });

/** Structured git status for a session worktree (Phase 0 foundation). */
export const gitStatus = (id: string): Promise<GitStatus> =>
  invoke("git_status", { id });

/**
 * Phase 4 — list files ignored by git for this session's worktree.
 * Paths are relative to the worktree root.
 */
export const gitListIgnoredFiles = (id: string): Promise<string[]> =>
  invoke("git_list_ignored_files", { id });

/**
 * Phase 4 — list files marked assume-unchanged (or skip-worktree) via
 * `git update-index`. Paths are relative to the worktree root.
 */
export const gitListAssumeUnchangedFiles = (id: string): Promise<string[]> =>
  invoke("git_list_assume_unchanged_files", { id });

export const getSessionFullDiff = (id: string): Promise<string> =>
  invoke("get_session_full_diff", { id });

export interface DiffViewOpts {
  ignoreWhitespace?: boolean;
  wordDiff?: boolean;
}

export const getSessionBranchDiff = (
  id: string,
  opts?: DiffViewOpts,
): Promise<string> =>
  invoke("get_session_branch_diff", { id, ...(opts ?? {}) });

export const getSessionStagedDiff = (
  id: string,
  opts?: DiffViewOpts,
): Promise<string> =>
  invoke("get_session_staged_diff", { id, ...(opts ?? {}) });

export const getSessionUntrackedDiff = (id: string): Promise<string> =>
  invoke("get_session_untracked_diff", { id });

export const stageFile = (id: string, filePath: string): Promise<void> =>
  invoke("stage_file", { id, filePath });

export const stageAll = (id: string): Promise<void> =>
  invoke("stage_all", { id });

export const unstageFile = (id: string, filePath: string): Promise<void> =>
  invoke("unstage_file", { id, filePath });

export const unstageAll = (id: string): Promise<void> =>
  invoke("unstage_all", { id });

export const discardFile = (id: string, filePath: string): Promise<void> =>
  invoke("discard_file", { id, filePath });

export const stageHunk = (id: string, patch: string): Promise<void> =>
  invoke("stage_hunk", { id, patch });

export const unstageHunk = (id: string, patch: string): Promise<void> =>
  invoke("unstage_hunk", { id, patch });

export const discardHunk = (
  id: string,
  patch: string,
  staged: boolean,
): Promise<void> => invoke("discard_hunk", { id, patch, staged });

export const gitCommit = (
  id: string,
  message: string,
  amend: boolean,
): Promise<string> => invoke("git_commit", { id, message, amend });

export const getLastCommitMessage = (id: string): Promise<string> =>
  invoke("get_last_commit_message", { id });

export const getLastCommitHash = (id: string): Promise<string> =>
  invoke("get_last_commit_hash", { id });

export const getGitAuthor = (id: string): Promise<[string, string]> =>
  invoke("get_git_author", { id });

export const gitPull = (
  id: string,
  remoteBranch?: string,
  rebase?: boolean,
): Promise<string> =>
  invoke("git_pull", {
    id,
    ...(remoteBranch && { remoteBranch }),
    ...(rebase && { rebase }),
  });

export const gitPush = (id: string): Promise<string> =>
  invoke("git_push", { id });

export const gitFetch = (id: string): Promise<string> =>
  invoke("git_fetch", { id });

export const gitStash = (id: string): Promise<string> =>
  invoke("git_stash", { id });

export interface GitStashSaveOptions {
  includeUntracked?: boolean;
  keepIndex?: boolean;
  message?: string;
  /** Restrict the stash to these pathspecs (relative to repo root). */
  paths?: string[];
}

export const gitStashSave = (
  id: string,
  options: GitStashSaveOptions = {},
): Promise<string> =>
  invoke("git_stash_save", {
    id,
    message: options.message,
    includeUntracked: options.includeUntracked,
    keepIndex: options.keepIndex,
    paths: options.paths,
  });

export const gitStashBranch = (
  id: string,
  stashRef: string,
  branchName: string,
): Promise<string> => invoke("git_stash_branch", { id, stashRef, branchName });

export const gitStashPop = (id: string): Promise<string> =>
  invoke("git_stash_pop", { id });

export interface GitCommit {
  abbreviatedHash: string;
  author: string;
  authorEmail: string;
  body: string;
  committer: string;
  committerDate: string;
  committerEmail: string;
  date: string;
  hash: string;
  parentHash: string;
  refs: string;
  subject: string;
  treeHash: string;
}

export interface GitStashEntry {
  author: string;
  authorEmail: string;
  date: string;
  hash: string;
  index: number;
  message: string;
  parentHash: string;
}

export const gitLog = (
  id: string,
  count?: number,
  allBranches?: boolean,
): Promise<GitCommit[]> =>
  invoke("git_log", {
    id,
    count: count ?? 100,
    allBranches: allBranches ?? true,
  });

export const gitShowCommit = (
  id: string,
  commitHash: string,
): Promise<string> => invoke("git_show_commit", { id, commitHash });

export const gitStashList = (id: string): Promise<GitStashEntry[]> =>
  invoke("git_stash_list", { id });

export const gitStashShow = (id: string, stashIndex: number): Promise<string> =>
  invoke("git_stash_show", { id, stashIndex });

export const gitStashApply = (
  id: string,
  stashIndex: number,
): Promise<string> => invoke("git_stash_apply", { id, stashIndex });

export const gitStashDrop = (id: string, stashIndex: number): Promise<string> =>
  invoke("git_stash_drop", { id, stashIndex });

/**
 * Restore one or more paths in the working tree from a ref (commit hash,
 * `stash@{N}`, branch name, etc). Used by the working-copy drop targets to
 * apply files from a stash or a previous commit.
 */
export const gitCheckoutPaths = (
  id: string,
  ref: string,
  paths: string[],
): Promise<string> => invoke("git_checkout_paths", { id, ref, paths });

// Phase 2 W5 — discard / untrack / gitignore
export const gitDiscardFile = (id: string, filePath: string): Promise<void> =>
  invoke("git_discard_file", { id, filePath });

export const gitDiscardHunk = (id: string, hunkPatch: string): Promise<void> =>
  invoke("git_discard_hunk", { id, hunkPatch });

export const gitDiscardLines = (
  id: string,
  filePath: string,
  lines: number[],
  side: "new" | "old",
  hunkPatch: string,
): Promise<void> =>
  invoke("git_discard_lines", { id, filePath, lines, side, hunkPatch });

export const gitUntrackFile = (id: string, filePath: string): Promise<void> =>
  invoke("git_untrack_file", { id, filePath });

export const addToGitignore = (id: string, filePath: string): Promise<void> =>
  invoke("add_to_gitignore", { id, filePath });

// Phase 2 W9 — conflict resolution
export const gitContinueMerge = (id: string): Promise<void> =>
  invoke("git_continue_merge", { id });

export const gitAbortMerge = (id: string): Promise<void> =>
  invoke("git_abort_merge", { id });

export const gitContinueRebase = (id: string): Promise<void> =>
  invoke("git_continue_rebase", { id });

export const gitAbortRebase = (id: string): Promise<void> =>
  invoke("git_abort_rebase", { id });

export const gitSkipRebase = (id: string): Promise<void> =>
  invoke("git_skip_rebase", { id });

export const gitContinueCherryPick = (id: string): Promise<void> =>
  invoke("git_continue_cherry_pick", { id });

export const gitAbortCherryPick = (id: string): Promise<void> =>
  invoke("git_abort_cherry_pick", { id });

export interface ConflictBlobs {
  base: string;
  merged: string;
  ours: string;
  theirs: string;
}

export const gitGetConflict = (
  id: string,
  filePath: string,
): Promise<ConflictBlobs> => invoke("git_get_conflict", { id, filePath });

export const gitMarkResolved = (id: string, filePath: string): Promise<void> =>
  invoke("git_mark_resolved", { id, filePath });

export const gitWriteConflictMerged = (
  id: string,
  filePath: string,
  contents: string,
): Promise<void> =>
  invoke("git_write_conflict_merged", { id, filePath, contents });

// Phase 2 W10 — git config
export const gitGetConfig = (id: string, key: string): Promise<string | null> =>
  invoke("git_get_config", { id, key });

export const gitSetConfig = (
  id: string,
  key: string,
  value: string,
): Promise<void> => invoke("git_set_config", { id, key, value });

// Phase 2 W10 — remotes + issue autocomplete scaffold
export interface GitRemote {
  name: string;
  url: string;
}

export const gitGetRemotes = (id: string): Promise<GitRemote[]> =>
  invoke("git_get_remotes", { id });

export interface RecentIssue {
  number: number;
  state: "closed" | "open";
  title: string;
}

export const gitListRecentIssues = (
  id: string,
  query: string,
): Promise<RecentIssue[]> => invoke("git_list_recent_issues", { id, query });

export const gitAmendTip = (
  id: string,
  subject: string,
  body: string,
): Promise<string> => invoke("git_amend_tip", { id, subject, body });

// ---------------------------------------------------------------------------
// Phase 4 — History depth (search, compare, blame, file history, reflog)
// ---------------------------------------------------------------------------

export interface LogSearchCursor {
  lastCommitHash: string;
  lastCommitTimestamp: string;
}

export interface LogSearchFilters {
  author?: string;
  branch?: string;
  cursor?: LogSearchCursor | null;
  limit?: number;
  paths?: string[];
  query?: string;
  refType?: "all" | "locals" | "remotes" | "tags";
  regex?: boolean;
  since?: string;
  until?: string;
}

export interface LogSearchResult {
  commits: GitCommit[];
  nextCursor: LogSearchCursor | null;
}

export const gitSearchLog = (
  id: string,
  filters: LogSearchFilters = {},
): Promise<LogSearchResult> => invoke("git_search_log", { id, ...filters });

export interface GitDiffRangeFile {
  newPath: string;
  oldPath: string;
  patch: string;
  status: string;
}

export interface GitDiffRangeResult {
  files: GitDiffRangeFile[];
}

export const gitDiffRange = (
  id: string,
  fromRef: string,
  toRef: string,
): Promise<GitDiffRangeResult> =>
  invoke("git_diff_range", { id, fromRef, toRef });

export const gitFileHistory = (
  id: string,
  path: string,
): Promise<GitCommit[]> => invoke("git_file_history", { id, path });

export interface BlameChunk {
  author: string;
  authorEmail: string;
  authorTime: number;
  commitHash: string;
  content?: string[];
  lineCount: number;
  lineStart: number;
  summary: string;
}

export const gitBlameFile = (
  id: string,
  path: string,
  ref?: string,
): Promise<BlameChunk[]> =>
  invoke("git_blame_file", { id, path, ...(ref ? { ref } : {}) });

/**
 * Read a file at a given git ref as a base64 string.
 * Pass ref = "WORKTREE" to read the live on-disk file instead of a git object.
 * Returns the raw bytes encoded as base64 (no data-URL prefix).
 */
export const gitReadBlobAtRef = (
  id: string,
  path: string,
  ref: string,
): Promise<string> => invoke("git_read_blob_at_ref", { id, path, ref });

export interface ReflogEntry {
  action: string;
  hash: string;
  refName: string;
  subject: string;
  timestamp: string;
}

export const gitReflog = (
  id: string,
  options: { limit?: number; ref?: string } = {},
): Promise<ReflogEntry[]> => invoke("git_reflog", { id, ...options });

export const watchSession = (id: string): Promise<void> =>
  invoke("watch_session", { id });

export const unwatchSession = (id: string): Promise<void> =>
  invoke("unwatch_session", { id });

export const pauseAllWatchers = (): Promise<void> =>
  invoke("pause_all_watchers");

export const resumeAllWatchers = (): Promise<void> =>
  invoke("resume_all_watchers");

// Base branch / merge commands
export const setSessionBaseBranch = (
  id: string,
  baseBranch: string,
): Promise<void> => invoke("set_session_base_branch", { id, baseBranch });

export const getSessionConflicts = (id: string): Promise<string[]> =>
  invoke("get_session_conflicts", { id });

export const getSessionMergeBlockers = (id: string): Promise<string[]> =>
  invoke("get_session_merge_blockers", { id });

export const getSessionReleaseNotes = (
  id: string,
): Promise<SessionReleaseNotesResult> =>
  invoke("get_session_release_notes", { id });

export const previewReleaseNotes = (
  repoRoot: string,
  patterns: ReleaseNotePatternConfig[],
): Promise<{ entries: ReleaseNoteEntry[] }> =>
  invoke("preview_release_notes", { repoRoot, patterns });

export const getSessionCommitsAhead = (id: string): Promise<number> =>
  invoke("get_session_commits_ahead", { id });

export const mergeSessionIntoBase = (id: string): Promise<void> =>
  invoke("merge_session_into_base", { id });

export const getSessionCommitsBehind = (id: string): Promise<number> =>
  invoke("get_session_commits_behind", { id });

export const rebaseSessionOnBase = (id: string): Promise<void> =>
  invoke("rebase_session_on_base", { id });

export const pushSessionBranch = (
  id: string,
): Promise<{ branch: string; prUrl: string | null; remoteName: string }> =>
  invoke("push_session_branch", { id });

// File commands
export const listDirectory = (
  id: string,
  relativePath: string,
): Promise<DirEntry[]> => invoke("list_directory", { id, relativePath });

export const listSessionFiles = (id: string): Promise<string[]> =>
  invoke("list_session_files", { id });

/**
 * List the entries of a directory at an absolute path. The backend rejects
 * paths that aren't inside a registered session/project root. Used by the
 * project-settings dialog's glob autocomplete.
 */
export const listPath = (path: string): Promise<DirEntry[]> =>
  invoke("list_path", { path });

export const resolveMentionPath = (
  id: string,
  query: string,
): Promise<MentionPathResult> => invoke("resolve_mention_path", { id, query });

export const readFile = (id: string, relativePath: string): Promise<string> =>
  invoke("read_file", { id, relativePath });

export const writeFile = (
  id: string,
  relativePath: string,
  content: string,
): Promise<void> => invoke("write_file", { id, relativePath, content });

export const statFile = (id: string, relativePath: string): Promise<FileStat> =>
  invoke("stat_file", { id, relativePath });

// System / peer-dependency probes
export const checkDependencies = (): Promise<DependencyReport> =>
  invoke("check_dependencies");

// Agent commands
export const checkClaudeCli = (): Promise<string> => invoke("check_claude_cli");

export const startAgent = (
  sessionId: string,
  model?: string,
  permissionMode?: string,
  resumeSessionId?: string,
  appendSystemPrompt?: string,
  agentId?: string,
): Promise<AgentStatus> =>
  invoke("start_agent", {
    sessionId,
    ...(model != null && model !== "" && { model }),
    ...(permissionMode != null && permissionMode !== "" && { permissionMode }),
    ...(resumeSessionId != null &&
      resumeSessionId !== "" && { resumeSessionId }),
    ...(appendSystemPrompt != null &&
      appendSystemPrompt !== "" && { appendSystemPrompt }),
    ...(agentId != null && agentId !== "" && { agentId }),
  });

export const stopAgent = (agentId: string): Promise<void> =>
  invoke("stop_agent", { agentId });

export const interruptAgent = (agentId: string): Promise<void> =>
  invoke("interrupt_agent", { agentId });

export interface ImageAttachment {
  /** Base64-encoded image data (no data-URL prefix). */
  data: string;
  /** MIME type, e.g. "image/png", "image/jpeg". */
  media_type: string;
}

export const sendAgentMessage = (
  agentId: string,
  message: string,
  images?: ImageAttachment[],
): Promise<void> =>
  invoke("send_agent_message", {
    agentId,
    message,
    images: images?.length ? images : null,
  });

export const listAgents = (sessionId: string): Promise<AgentStatus[]> =>
  invoke("list_agents", { sessionId });

export const setAgentModel = (agentId: string, model: string): Promise<void> =>
  invoke("set_agent_model", { agentId, model });

export const setAgentPermissionMode = (
  agentId: string,
  mode: string,
): Promise<void> => invoke("set_agent_permission_mode", { agentId, mode });

export const setAgentEffort = (
  agentId: string,
  level: string | null,
): Promise<void> => invoke("set_agent_effort", { agentId, level });

export const prewarmAgent = (sessionId: string): Promise<AgentStatus> =>
  invoke("prewarm_agent", { sessionId });

export const claimPrewarmAgent = (
  agentId: string,
  opts: { model?: string; permissionMode?: string } = {},
): Promise<AgentStatus> =>
  invoke("claim_prewarm_agent", {
    agentId,
    model: opts.model,
    permissionMode: opts.permissionMode,
  });

export const discardPrewarmAgent = (agentId: string): Promise<void> =>
  invoke("discard_prewarm_agent", { agentId });

export const respondToPermission = (
  agentId: string,
  toolUseId: string,
  decision: "allow" | "deny",
  allowRule?: string,
  allowAll?: boolean,
  denyMessage?: string,
): Promise<void> =>
  invoke("respond_to_permission", {
    agentId,
    toolUseId,
    decision,
    allowRule: allowRule ?? null,
    allowAll: allowAll ?? null,
    denyMessage: denyMessage ?? null,
  });

// Config file command
export const writeArgusConfig = (
  repoRoot: string,
  content: string,
): Promise<void> => invoke("write_argus_config", { repoRoot, content });

// Config read command
export const readArgusConfig = (repoRoot: string): Promise<ArgusConfig> =>
  invoke("read_argus_config", { repoRoot });

// Returns the running Argus app version (semver string).
export const getAppVersion = (): Promise<string> => invoke("get_app_version");

// Per-developer, per-project personal settings (stored outside the repo).
export const getUserProjectSettings = (
  repoRoot: string,
): Promise<UserProjectSettings> =>
  invoke("get_user_project_settings", { repoRoot });

export const setUserProjectSettings = (
  repoRoot: string,
  settings: UserProjectSettings,
): Promise<UserProjectSettings> =>
  invoke("set_user_project_settings", { repoRoot, settings });

/**
 * Archive a branch (UI-only — git is untouched). Returns the new archived list.
 */
export const gitArchiveBranch = (
  repoRoot: string,
  branch: string,
): Promise<string[]> => invoke("git_archive_branch", { repoRoot, branch });

/** Unarchive a branch. Returns the new archived list. */
export const gitUnarchiveBranch = (
  repoRoot: string,
  branch: string,
): Promise<string[]> => invoke("git_unarchive_branch", { repoRoot, branch });

/** List archived branch names for a project. */
export const gitListArchivedBranches = (repoRoot: string): Promise<string[]> =>
  invoke("git_list_archived_branches", { repoRoot });

/** Pin a branch for quick access. Returns the new pinned list. */
export const gitPinBranch = (
  repoRoot: string,
  branch: string,
): Promise<string[]> => invoke("git_pin_branch", { repoRoot, branch });

/** Unpin a branch. Returns the new pinned list. */
export const gitUnpinBranch = (
  repoRoot: string,
  branch: string,
): Promise<string[]> => invoke("git_unpin_branch", { repoRoot, branch });

/** List pinned branch names for a project. */
export const gitListPinnedBranches = (repoRoot: string): Promise<string[]> =>
  invoke("git_list_pinned_branches", { repoRoot });

/**
 * Stash uncommitted changes, checkout `branch`, then pop the stash.
 * Use when `gitCheckout` fails with `dirty-working-tree`.
 */
export const gitStashAndCheckout = (
  sessionId: string,
  branch: string,
): Promise<void> => invoke("git_stash_and_checkout", { id: sessionId, branch });

/**
 * Discard all uncommitted changes then checkout `branch`.
 * Use when the user explicitly chooses to discard on dirty checkout.
 */
export const gitDiscardAndCheckout = (
  sessionId: string,
  branch: string,
): Promise<void> =>
  invoke("git_discard_and_checkout", { id: sessionId, branch });

// Machine-local app settings (~/.argus/app-settings.json).
export const getAppSettings = (): Promise<AppSettings> =>
  invoke("get_app_settings", {});

export const setAppSettings = (settings: AppSettings): Promise<AppSettings> =>
  invoke("set_app_settings", { settings });

// Remote access (phone/web control).
export const remoteGetStatus = (): Promise<RemoteStatus> =>
  invoke("remote_get_status", {});

export const remoteSetConfig = (config: {
  enabled?: boolean;
  lanWeb?: boolean;
  provider?: "cloudflare" | "none" | "tailscale";
  publicUrl?: string;
  tunnelMode?: "quick" | "token";
  tunnelToken?: string;
}): Promise<RemoteStatus> => invoke("remote_set_config", { config });

export const remoteListDevices = (): Promise<RemoteDevice[]> =>
  invoke("remote_list_devices", {});

export const remoteRevokeDevice = (deviceId: string): Promise<RemoteStatus> =>
  invoke("remote_revoke_device", { deviceId });

export const remoteStartPairing = (): Promise<RemotePairingStart> =>
  invoke("remote_start_pairing", {});

export const remoteConfirmPairing = (control = false): Promise<void> =>
  invoke("remote_confirm_pairing", { control });

export const remoteCancelPairing = (): Promise<void> =>
  invoke("remote_cancel_pairing", {});

/** Grant or revoke the "control" capability for an already-paired device. */
export const remoteSetDeviceControl = (
  deviceId: string,
  control: boolean,
): Promise<RemoteDevice[]> =>
  invoke("remote_set_device_control", { deviceId, control });

/**
 * Enumerate MCP servers Argus inherits from Claude Code (plugins,
 * `~/.claude.json`, the worktree's `.mcp.json`). Pass the worktree path to
 * include project-scoped sources; omit it for the global view.
 */
export const listInheritedMcpServers = (
  worktreePath?: string | null,
): Promise<InheritedMcpServer[]> =>
  invoke("list_inherited_mcp_servers", {
    worktreePath: worktreePath ?? null,
  });

/**
 * Run a JSON-RPC `initialize` handshake against an MCP server config to
 * confirm it's reachable. `config` matches the value stored under each
 * `mcpServers[name]` key.
 */
export const testMcpServer = (
  config: Record<string, unknown>,
): Promise<McpTestResult> => invoke("test_mcp_server", { config });

/**
 * Drive the OAuth 2.1 sign-in flow for an MCP HTTP server. Opens the
 * system browser, waits for the user to complete auth, then persists the
 * resulting bearer token. Resolves to the stored status on success.
 */
export const signInToMcpServer = (params: {
  resourceMetadataUrl?: string | null;
  serverUrl: string;
}): Promise<McpOAuthStatus> =>
  invoke("mcp_oauth_sign_in", {
    serverUrl: params.serverUrl,
    resourceMetadataUrl: params.resourceMetadataUrl ?? null,
  });

export const signOutFromMcpServer = (serverUrl: string): Promise<void> =>
  invoke("mcp_oauth_sign_out", { serverUrl });

export const cancelMcpSignIn = (serverUrl: string): Promise<boolean> =>
  invoke("mcp_oauth_cancel_sign_in", { serverUrl });

export const getMcpOAuthStatus = (
  serverUrl: string,
): Promise<McpOAuthStatus | null> => invoke("mcp_oauth_status", { serverUrl });

export const listAuthorizedMcpServers = (): Promise<string[]> =>
  invoke("mcp_oauth_list_authorized", {});

// Command metrics (per-project slash command popularity)
export const getCommandMetrics = (
  repoRoot: string,
): Promise<Record<string, number>> =>
  invoke("get_command_metrics", { repoRoot });

// Chat history commands
export const saveChatHistory = (
  repoRoot: string,
  conversation: SavedConversation,
): Promise<void> =>
  invoke("save_chat_history", {
    repoRoot,
    conversation: conversation as unknown as Record<string, unknown>,
  });

export const listChatHistory = (
  repoRoot: string,
): Promise<ChatHistoryEntry[]> => invoke("list_chat_history", { repoRoot });

export const searchChatHistory = (
  repoRoot: string,
  query: string,
): Promise<ChatHistorySearchResult[]> =>
  invoke("search_chat_history", { repoRoot, query });

export const loadChatHistory = (
  repoRoot: string,
  historyId: string,
): Promise<SavedConversation | null> =>
  invoke("load_chat_history", { repoRoot, historyId });

export const deleteChatHistory = (
  repoRoot: string,
  historyId: string,
): Promise<void> => invoke("delete_chat_history", { repoRoot, historyId });

export const generateSessionTitle = (
  firstMessage: string,
): Promise<string | null> => invoke("generate_session_title", { firstMessage });

// Terminal commands.
//
// `createTerminal` only spawns the user's interactive login shell — it
// intentionally cannot accept a command string. Use `createRunTerminal` to
// start the session's configured `run` command from `.argus.json`; the
// command is resolved server-side so the renderer never gets to choose what
// runs in `sh -c`.
export const createTerminal = (
  sessionId: string,
  subDir?: string,
  title?: string,
): Promise<string> =>
  invoke("create_terminal", {
    sessionId,
    ...(subDir != null && subDir !== "" && { subDir }),
    ...(title != null && title !== "" && { title }),
  });

export interface TerminalSummary {
  exitCode: number | null;
  exited: boolean;
  id: string;
  runTitle: string | null;
  sessionId: string;
  title: string | null;
}

export const listTerminals = (sessionId: string): Promise<TerminalSummary[]> =>
  invoke("list_terminals", { sessionId });

export const updateTerminalTitle = (
  terminalId: string,
  title: string,
): Promise<void> => invoke("update_terminal_title", { terminalId, title });

export interface CreateRunTerminalResult {
  /**
   * Newly-spawned dependency terminals (from the entry's `requires` chain)
   * that the renderer also needs to register as tabs and attach buffer
   * listeners to. Empty when no dependencies were started.
   */
  dependencies: { sessionId: string; title: string }[];
  sessionId: string;
  started: boolean;
  title: string;
}

export const createRunTerminal = (
  sessionId: string,
  title?: string,
): Promise<CreateRunTerminalResult> =>
  invoke("create_run_terminal", {
    sessionId,
    ...(title != null && title !== "" && { title }),
  });

// Simulator popout — opens the simulator view in a separate always-on-top window.
export const openSimulatorPopout = (udid: string): Promise<void> =>
  invoke("open_simulator_popout", { udid });

export const closeSimulatorPopout = (udid: string): Promise<void> =>
  invoke("close_simulator_popout", { udid });

// Agent popout — detach an agent into its own window. The backend creates a
// BrowserWindow that loads the renderer bundle with `?popout=agent` and
// broadcasts `agent:popout-opened` / `agent:popout-closed` so every window
// can keep its tab bar in sync.
export const openAgentPopout = (args: {
  agentId: string;
  /** Screen coords of the drop cursor, if this was triggered by a drag. */
  cursorX?: number;
  cursorY?: number;
  sessionId: string;
  title?: string;
}): Promise<void> => invoke("open_agent_popout", args);

export const closeAgentPopout = (agentId: string): Promise<void> =>
  invoke("close_agent_popout", { agentId });

export const listPoppedOutAgents = (): Promise<string[]> =>
  invoke("list_popped_out_agents");

// Cross-window conversation snapshot sharing — lets a newly opened popout (or
// reloaded main) hydrate an agent's conversation from whichever window last
// owned it, without waiting for the next live event.
export const publishAgentSnapshot = (
  agentId: string,
  snapshot: string | null,
): Promise<void> =>
  invoke("publish_agent_snapshot", { agentId, snapshot: snapshot ?? "" });

export const getAgentSnapshot = (agentId: string): Promise<string | null> =>
  invoke("get_agent_snapshot", { agentId });

export const getSession = (id: string): Promise<Session | null> =>
  invoke("get_session", { id });

export const startTerminal = (
  sessionId: string,
  cols: number,
  rows: number,
): Promise<void> => invoke("start_terminal", { sessionId, cols, rows });

export const destroyTerminal = (sessionId: string): Promise<void> =>
  invoke("destroy_terminal", { sessionId });

/**
 * Gracefully stop the process running in a terminal session by escalating
 * SIGINT → SIGTERM → SIGKILL. Returns immediately; the renderer will receive
 * a `terminal:exit:{sessionId}` event when the process actually exits.
 */
export const stopTerminal = (sessionId: string): Promise<void> =>
  invoke("stop_terminal", { sessionId });

export const terminalWrite = (sessionId: string, data: string): Promise<void> =>
  invoke("terminal_write", { sessionId, data });

export const terminalResize = (
  sessionId: string,
  cols: number,
  rows: number,
): Promise<void> => invoke("terminal_resize", { sessionId, cols, rows });

// Simulator commands
export const checkIosTools = (): Promise<void> => invoke("check_ios_tools");

export const listSimulators = (): Promise<SimulatorDevice[]> =>
  invoke("list_simulators");

export const bootSimulator = (udid: string): Promise<void> =>
  invoke("boot_simulator", { udid });

export const disconnectSimulator = (udid: string): Promise<void> =>
  invoke("disconnect_simulator", { udid });

export const startSimulatorCapture = (udid: string): Promise<number> =>
  invoke("start_simulator_capture", { udid });

export const stopSimulatorCapture = (udid: string): Promise<void> =>
  invoke("stop_simulator_capture", { udid });

export const simulatorTouch = (
  udid: string,
  x: number,
  y: number,
  eventType: number,
): Promise<void> => invoke("simulator_touch", { udid, x, y, eventType });

export const simulatorButton = (udid: string, button: string): Promise<void> =>
  invoke("simulator_button", { udid, button });

/**
 * Open a URL / deep link on the given device via `conductor open-link`.
 * `deviceKey` is the iOS UDID, Android serial, or web browser deviceId.
 */
export const openDeviceDeepLink = (
  deviceKey: string,
  url: string,
): Promise<void> => invoke("device_open_link", { deviceKey, url });

export const simulatorKeyboard = (
  udid: string,
  keyCode: number,
  modifierFlags: number,
  isDown: boolean,
): Promise<void> =>
  invoke("simulator_keyboard", { udid, keyCode, modifierFlags, isDown });

// Android device commands
export const checkAndroidTools = (): Promise<void> =>
  invoke("check_android_tools");

export const listAndroidDevices = (): Promise<AndroidDevice[]> =>
  invoke("list_android_devices");

export const listAvds = (): Promise<string[]> => invoke("list_avds");

export const bootAndroidEmulator = (avdName: string): Promise<string> =>
  invoke("boot_android_emulator", { avdName });

export const startAndroidCapture = (serial: string): Promise<void> =>
  invoke("start_android_capture", { serial });

export const stopAndroidCapture = (): Promise<void> =>
  invoke("stop_android_capture");

export const disconnectAndroidDevice = (serial: string): Promise<void> =>
  invoke("disconnect_android_device", { serial });

export const androidTouch = (
  serial: string,
  x: number,
  y: number,
  eventType: number,
): Promise<void> => invoke("android_touch", { serial, x, y, eventType });

export const androidKeyboard = (
  keyCode: number,
  metaState: number,
  isDown: boolean,
): Promise<void> => invoke("android_keyboard", { keyCode, metaState, isDown });

export const androidButton = (button: string): Promise<void> =>
  invoke("android_button", { button });

/** macOS camera (capture-card) TCC status: granted | denied | restricted | not-determined | unknown. */
export const requestCameraAccess = (): Promise<string> =>
  invoke("request_camera_access");

// Browser commands — Playwright Chromium-backed embedded browser per session.

export const browserViewEnsure = (sessionId: string): Promise<void> =>
  invoke("browser_view_ensure", { sessionId });

export const browserViewNavigate = (
  sessionId: string,
  url: string,
): Promise<void> => invoke("browser_view_navigate", { sessionId, url });

export const browserViewBack = (sessionId: string): Promise<void> =>
  invoke("browser_view_back", { sessionId });

export const browserViewForward = (sessionId: string): Promise<void> =>
  invoke("browser_view_forward", { sessionId });

export const browserViewReload = (sessionId: string): Promise<void> =>
  invoke("browser_view_reload", { sessionId });

export const browserViewDestroy = (sessionId: string): Promise<void> =>
  invoke("browser_view_destroy", { sessionId });

export const browserMouseEvent = (
  sessionId: string,
  type: "click" | "down" | "move" | "up",
  x: number,
  y: number,
  button?: "left" | "middle" | "right",
): Promise<void> =>
  invoke("browser_mouse_event", { sessionId, type, x, y, button });

export const browserKeyboardEvent = (
  sessionId: string,
  type: "down" | "press" | "up",
  key: string,
): Promise<void> => invoke("browser_keyboard_event", { sessionId, type, key });

export const browserWheelEvent = (
  sessionId: string,
  x: number,
  y: number,
  deltaX: number,
  deltaY: number,
): Promise<void> =>
  invoke("browser_wheel_event", { sessionId, x, y, deltaX, deltaY });

export interface BrowserPresetConfig {
  internalHeight: number;
  internalWidth: number;
  screenPosition?: "desktop" | "mobile";
  userAgent?: string;
}

export const browserUpdatePreset = (
  sessionId: string,
  preset: BrowserPresetConfig,
): Promise<void> => invoke("browser_update_preset", { sessionId, preset });

export const browserGetMjpegPort = (): Promise<number> =>
  invoke("browser_get_mjpeg_port");

// Devices + conductor logs
export const listDevices = (): Promise<DeviceInfo[]> => invoke("list_devices");

export const stopDevice = (
  platform: DevicePlatform,
  deviceKey: string,
): Promise<void> => invoke("stop_device", { platform, deviceKey });

export const listConductorLogs = (
  deviceKey: string,
): Promise<ConductorLogEntry[]> => invoke("list_conductor_logs", { deviceKey });

export const runConductorCommand = (
  deviceKey: string,
  args: string[],
): Promise<void> => invoke("run_conductor_command", { deviceKey, args });

export const inspectionCapture = <T = unknown>(deviceKey: string): Promise<T> =>
  invoke("inspection_capture", { deviceKey });

// Debug panel
export interface DebugCommandResult {
  durationMs: number;
  error?: string;
  ok: boolean;
  stderr?: string;
  stdout: string;
}

export const debugStartStream = (
  streamId: string,
  deviceKey: string,
  args: string[],
): Promise<void> => invoke("debug_start_stream", { streamId, deviceKey, args });

export const debugStopStream = (streamId: string): Promise<void> =>
  invoke("debug_stop_stream", { streamId });

export const debugRunCommand = (
  deviceKey: string,
  args: string[],
): Promise<DebugCommandResult> =>
  invoke("debug_run_command", { deviceKey, args });

// Shell commands
export const revealInFinder = (path: string): Promise<void> =>
  invoke("reveal_in_finder", { path });

/** Mirror a notification to connected remote devices (fire-and-forget). */
export interface RemoteNotifyPayload {
  agent_id: string | null;
  body: string;
  kind: "failed" | "finished" | "permission" | "push";
  session_id: string | null;
  title: string;
}
export const remoteNotify = (payload: RemoteNotifyPayload): Promise<void> =>
  invoke("remote_notify", payload as unknown as Record<string, unknown>);

/** Open a file/folder with the system's default handler. */
export const openPath = (path: string): Promise<void> =>
  invoke("open_path", { path });

export const openExternalUrl = (url: string): Promise<void> =>
  invoke("open_external_url", { url });

export interface EditorDescriptor {
  available: boolean;
  id: string;
  name: string;
}

export const listEditors = (): Promise<EditorDescriptor[]> =>
  invoke("list_editors");

export const openInEditor = (editorId: string, path: string): Promise<void> =>
  invoke("open_in_editor", { editorId, path });

export const openInCustomEditor = (
  command: string,
  path: string,
): Promise<void> => invoke("open_in_custom_editor", { command, path });

export const showImageContextMenu = (
  src: string,
  suggestedName?: string,
): Promise<void> => invoke("show_image_context_menu", { src, suggestedName });

// Organizations
export const listOrganizations = (): Promise<Organization[]> =>
  invoke("list_organizations");

export interface CreateOrganizationInput {
  accent?: string;
  description?: string;
  members?: OrganizationMember[];
  name: string;
  systemPrompt?: string;
}

export const createOrganization = (
  input: CreateOrganizationInput,
): Promise<Organization> => invoke("create_organization", { ...input });

export interface UpdateOrganizationInput {
  accent?: string;
  description?: string;
  id: string;
  members?: OrganizationMember[];
  name?: string;
  systemPrompt?: string;
}

export const updateOrganization = (
  input: UpdateOrganizationInput,
): Promise<Organization> => invoke("update_organization", { ...input });

export const deleteOrganization = (id: string): Promise<void> =>
  invoke("delete_organization", { id });

export const addRepoToOrganization = (
  id: string,
  repoRoot: string,
  role: string,
): Promise<Organization> =>
  invoke("add_repo_to_organization", { id, repoRoot, role });

export const removeRepoFromOrganization = (
  id: string,
  repoRoot: string,
): Promise<Organization> =>
  invoke("remove_repo_from_organization", { id, repoRoot });

// Organization tasks
export interface StartOrgTaskInput {
  organizationId: string;
  prompt: string;
  scope: { repo_root: string }[];
  title: string;
}

export const listOrgTasks = (organizationId?: string): Promise<OrgTask[]> =>
  invoke("list_org_tasks", organizationId ? { organizationId } : {});

export const getOrgTask = (id: string): Promise<OrgTask | null> =>
  invoke("get_org_task", { id });

export const startOrgTask = (input: StartOrgTaskInput): Promise<OrgTask> =>
  invoke("start_org_task", { ...input });

export const cancelOrgTask = (id: string): Promise<OrgTask> =>
  invoke("cancel_org_task", { id });

export const deleteOrgTaskIpc = (id: string): Promise<void> =>
  invoke("delete_org_task", { id });

// UI state — lightweight persisted key/value blobs (e.g. last route).
export const getUiState = (key: string): Promise<string | null> =>
  invoke("ui_state_get", { key });

export const setUiState = (key: string, value: string): Promise<void> =>
  invoke("ui_state_set", { key, value });

// Onboarding
export const getOnboardingState = (): Promise<OnboardingConfigFile> =>
  invoke("onboarding_get_state");

export const ensureArgusDir = (): Promise<{ path: string }> =>
  invoke("onboarding_ensure_argus_dir");

export const setOnboardingLastStep = (step: OnboardingStep): Promise<void> =>
  invoke("onboarding_set_last_step", { step });

export const addOnboardingSkipped = (id: string): Promise<void> =>
  invoke("onboarding_add_skipped", { id });

export const checkPrereqs = (ids?: PrereqId[]): Promise<PrereqResult[]> =>
  invoke("onboarding_check_prereqs", ids ? { ids } : {});

export const runPrereqFixer = (
  id: PrereqId,
  args?: { gitEmail?: string; gitName?: string },
): Promise<{ error?: string; ok: boolean }> =>
  invoke("onboarding_run_fixer", { id, ...(args ?? {}) });

export const claudePing = (): Promise<{ error?: string; ok: boolean }> =>
  invoke("onboarding_claude_ping");

export const getClaudeAuthStatus = (
  accountId?: string,
): Promise<ClaudeAuthStatus> => invoke("claude_auth_status", { accountId });

export const claudeAuthLogout = (accountId?: string): Promise<void> =>
  invoke("claude_auth_logout", { accountId });

export const claudeAuthLoginStart = (
  useConsole: boolean,
  accountId?: string,
): Promise<{ url: string }> =>
  invoke("claude_auth_login_start", { useConsole, accountId });

export const listClaudeAccounts = (): Promise<ClaudeAccountsState> =>
  invoke("claude_accounts_list");

export const setActiveClaudeAccount = (id: string): Promise<void> =>
  invoke("claude_accounts_set_active", { id });

/** Sign in an additional account without disturbing the ones already signed in. */
export const addClaudeAccount = (
  useConsole: boolean,
): Promise<{ url: string }> => invoke("claude_accounts_add", { useConsole });

export const removeClaudeAccount = (id: string): Promise<void> =>
  invoke("claude_accounts_remove", { id });

export const renameClaudeAccount = (id: string, label: string): Promise<void> =>
  invoke("claude_accounts_rename", { id, label });

export const refreshClaudeAccount = (id: string): Promise<void> =>
  invoke("claude_accounts_refresh", { id });

/** Pin a session to an account, or pass `null` to follow the active account. */
export const setSessionClaudeAccount = (
  sessionId: string,
  accountId: string | null,
): Promise<void> =>
  invoke("set_session_claude_account", { sessionId, accountId });

export const claudeAuthLoginSubmitCode = (
  code: string,
): Promise<{ error?: string; ok: boolean }> =>
  invoke("claude_auth_login_submit_code", { code });

export const claudeAuthLoginCancel = (): Promise<void> =>
  invoke("claude_auth_login_cancel");

export const listRunnerOnboardingSteps = (): Promise<RunnerOnboardingStep[]> =>
  invoke("llm_list_onboarding_steps");

export const listRegisteredRunners = (): Promise<RegisteredRunner[]> =>
  invoke("llm_list_runners");

export const listOnboardingExamples = (): Promise<ExampleProject[]> =>
  invoke("onboarding_list_examples");

export const cloneOnboardingExample = (
  slug: string,
): Promise<{ path: string }> => invoke("onboarding_clone_example", { slug });

export const registerOnboardingProject = (repoPath: string): Promise<void> =>
  invoke("onboarding_register_project", { path: repoPath });

export const suggestArgusJson = (
  repoPath: string,
): Promise<ArgusConfigSuggestion> =>
  invoke("onboarding_suggest_argus_json", { path: repoPath });

export const readExistingArgusJson = (
  repoPath: string,
): Promise<Record<string, unknown> | null> =>
  invoke("onboarding_read_existing_argus_json", { path: repoPath });

export const writeOnboardingArgusJson = (
  repoPath: string,
  config: Record<string, unknown>,
): Promise<void> =>
  invoke("onboarding_write_argus_json", { path: repoPath, config });

export const refineArgusJsonWithClaude = (
  repoPath: string,
  config: Record<string, unknown>,
): Promise<Record<string, unknown>> =>
  invoke("onboarding_refine_argus_json_with_claude", {
    path: repoPath,
    config,
  });

export const completeOnboarding = (): Promise<void> =>
  invoke("onboarding_complete");

export const resetOnboarding = (): Promise<void> => invoke("onboarding_reset");

// Auto-updater
export type UpdaterPhase =
  | "available"
  | "checking"
  | "downloaded"
  | "downloading"
  | "error"
  | "idle"
  | "not-available";

export interface UpdaterState {
  currentVersion: string;
  error: string | null;
  lastCheckedAt: number | null;
  phase: UpdaterPhase;
  progressPercent: number;
  releaseDate: string | null;
  releaseNotes: string | null;
  updateVersion: string | null;
}

export const updaterGetState = (): Promise<UpdaterState> =>
  invoke("updater_get_state");

export const updaterCheck = (silent = false): Promise<UpdaterState> =>
  invoke("updater_check", { silent });

export const updaterDownload = (): Promise<void> => invoke("updater_download");

export const updaterQuitAndInstall = (): Promise<void> =>
  invoke("updater_quit_and_install");

// Telemetry
export type TelemetryMode = "full" | "off" | "presence";
export interface TelemetryInit {
  appVersion: string;
  configured: boolean;
  distinctId: string;
  mode: TelemetryMode;
}
export const getTelemetryInit = (): Promise<TelemetryInit> =>
  invoke("telemetry_get_init");
export const setTelemetryModeOnMain = (mode: TelemetryMode): Promise<void> =>
  invoke("telemetry_set_mode", { mode });
export const telemetryCapture = (
  event: string,
  props: Record<string, unknown>,
): Promise<void> => invoke("telemetry_capture", { event, props });
export const telemetryCaptureException = (
  message: string,
  stack: string | undefined,
  props: Record<string, unknown>,
): Promise<void> =>
  invoke("telemetry_capture_exception", { message, props, stack });
export const telemetryCaptureFeedback = (message: string): Promise<void> =>
  invoke("telemetry_capture_feedback", { message });

// GitHub issues (Phase 9 — commit message autocomplete)
export interface GhIssue {
  number: number;
  title: string;
}

/**
 * List open GitHub issues for the repo root.
 * Returns an empty array when `gh` is not installed or not authenticated.
 */
export const ghListIssues = (repoRoot: string): Promise<GhIssue[]> =>
  invoke("gh_list_issues", { repoRoot });

// Phase 10 — auto-fetch
/**
 * Reconfigure the auto-fetch timer for all active sessions in `repoRoot`.
 * Call this after writing a new `auto_fetch_minutes` value to `.argus.json`.
 */
export const gitReconfigureAutoFetch = (
  repoRoot: string,
  minutes: number | null,
): Promise<void> => invoke("git_reconfigure_auto_fetch", { repoRoot, minutes });

// Phase 5 — compare-branches view.
export interface CompareResult {
  leftOnly: BranchCommitSummary[];
  mergeBase: string | null;
  rightOnly: BranchCommitSummary[];
  wouldConflict: boolean;
}

/**
 * Return the diverging commit lists, merge-base SHA, and a best-effort
 * conflict-precheck for the two given refs.
 */
export const gitCompareBranches = (
  sessionId: string,
  left: string,
  right: string,
): Promise<CompareResult> =>
  invoke("git_compare_branches", { sessionId, left, right });

// Tools — renderer ↔ main mirror.
export const getEnabledToolsIpc = (): Promise<
  Partial<Record<string, boolean>>
> => invoke("get_enabled_tools");

export const setEnabledToolsIpc = (
  userEnabled: Partial<Record<string, boolean>>,
): Promise<void> => invoke("set_enabled_tools", { userEnabled });
