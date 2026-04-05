/**
 * Typed IPC wrappers for all Electron backend commands.
 *
 * All renderer → main communication goes through these functions.
 * Components should never call `window.stagehand.invoke()` directly.
 */

import type {
  AgentStatus,
  DirEntry,
  FileStat,
  Workspace,
  SimulatorDevice,
  StagehandConfig,
} from "./types";

declare global {
  interface Window {
    stagehand: {
      invoke<T>(channel: string, args?: Record<string, unknown>): Promise<T>;
      on<T>(event: string, callback: (payload: T) => void): () => void;
    };
  }
}

function invoke<T>(
  channel: string,
  args?: Record<string, unknown>,
): Promise<T> {
  return window.stagehand.invoke<T>(channel, args);
}

// Workspace commands
export const addRepoRoot = (path: string): Promise<void> =>
  invoke("add_repo_root", { path });

export const removeRepoRoot = (path: string): Promise<void> =>
  invoke("remove_repo_root", { path });

export const getRepoBranch = (repoRoot: string): Promise<string> =>
  invoke("get_repo_branch", { repoRoot });

export const listBranches = (repoRoot: string): Promise<string[]> =>
  invoke("list_branches", { repoRoot });

export const checkoutBranch = (
  repoRoot: string,
  branch: string,
): Promise<void> => invoke("checkout_branch", { repoRoot, branch });

export const listWorkspaces = (repoRoot: string): Promise<Workspace[]> =>
  invoke("list_workspaces", { repoRoot });

export const createWorkspace = (
  repoRoot: string,
  branch: string,
  description: string,
  useExistingBranch?: boolean,
): Promise<Workspace> =>
  invoke("create_workspace", {
    repoRoot,
    branch,
    description,
    useExistingBranch: useExistingBranch ?? false,
  });

export const createHeadWorkspace = (repoRoot: string): Promise<Workspace> =>
  invoke("create_head_workspace", { repoRoot });

export const deleteWorkspace = (
  id: string,
  deleteBranch?: boolean,
): Promise<void> =>
  invoke("delete_workspace", {
    id,
    shouldDeleteBranch: deleteBranch ?? false,
  });

export const getWorkspaceDiff = (id: string): Promise<string> =>
  invoke("get_workspace_diff", { id });

export const getWorkspaceStatus = (id: string): Promise<string> =>
  invoke("get_workspace_status", { id });

export const getWorkspaceFullDiff = (id: string): Promise<string> =>
  invoke("get_workspace_full_diff", { id });

export const getWorkspaceStagedDiff = (id: string): Promise<string> =>
  invoke("get_workspace_staged_diff", { id });

export const getWorkspaceUntrackedDiff = (id: string): Promise<string> =>
  invoke("get_workspace_untracked_diff", { id });

export const stageFile = (id: string, filePath: string): Promise<void> =>
  invoke("stage_file", { id, filePath });

export const unstageFile = (id: string, filePath: string): Promise<void> =>
  invoke("unstage_file", { id, filePath });

export const discardFile = (id: string, filePath: string): Promise<void> =>
  invoke("discard_file", { id, filePath });

export const stageHunk = (id: string, patch: string): Promise<void> =>
  invoke("stage_hunk", { id, patch });

export const unstageHunk = (id: string, patch: string): Promise<void> =>
  invoke("unstage_hunk", { id, patch });

export const discardHunk = (id: string, patch: string): Promise<void> =>
  invoke("discard_hunk", { id, patch });

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

export const gitStashPop = (id: string): Promise<string> =>
  invoke("git_stash_pop", { id });

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

export const watchWorkspace = (id: string): Promise<void> =>
  invoke("watch_workspace", { id });

export const unwatchWorkspace = (id: string): Promise<void> =>
  invoke("unwatch_workspace", { id });

export const pauseAllWatchers = (): Promise<void> =>
  invoke("pause_all_watchers");

export const resumeAllWatchers = (): Promise<void> =>
  invoke("resume_all_watchers");

// Base branch / merge commands
export const setWorkspaceBaseBranch = (
  id: string,
  baseBranch: string,
): Promise<void> => invoke("set_workspace_base_branch", { id, baseBranch });

export const getWorkspaceConflicts = (id: string): Promise<string[]> =>
  invoke("get_workspace_conflicts", { id });

export const mergeWorkspaceIntoBase = (id: string): Promise<void> =>
  invoke("merge_workspace_into_base", { id });

// File commands
export const listDirectory = (
  id: string,
  relativePath: string,
): Promise<DirEntry[]> => invoke("list_directory", { id, relativePath });

export const readFile = (id: string, relativePath: string): Promise<string> =>
  invoke("read_file", { id, relativePath });

export const writeFile = (
  id: string,
  relativePath: string,
  content: string,
): Promise<void> => invoke("write_file", { id, relativePath, content });

export const statFile = (id: string, relativePath: string): Promise<FileStat> =>
  invoke("stat_file", { id, relativePath });

// Agent commands
export const checkClaudeCli = (): Promise<string> => invoke("check_claude_cli");

export const startAgent = (
  workspaceId: string,
  model?: string,
  permissionMode?: string,
  resumeSessionId?: string,
): Promise<AgentStatus> =>
  invoke("start_agent", {
    workspaceId,
    ...(model != null && model !== "" && { model }),
    ...(permissionMode != null && permissionMode !== "" && { permissionMode }),
    ...(resumeSessionId != null &&
      resumeSessionId !== "" && { resumeSessionId }),
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

export const listAgents = (workspaceId: string): Promise<AgentStatus[]> =>
  invoke("list_agents", { workspaceId });

export const setAgentModel = (agentId: string, model: string): Promise<void> =>
  invoke("set_agent_model", { agentId, model });

export const setAgentPermissionMode = (
  agentId: string,
  mode: string,
): Promise<void> => invoke("set_agent_permission_mode", { agentId, mode });

export const respondToPermission = (
  agentId: string,
  toolUseId: string,
  decision: "allow" | "deny",
  allowRule?: string,
  allowAll?: boolean,
): Promise<void> =>
  invoke("respond_to_permission", {
    agentId,
    toolUseId,
    decision,
    allowRule: allowRule ?? null,
    allowAll: allowAll ?? null,
  });

// Config file command
export const writeStagehandConfig = (
  repoRoot: string,
  content: string,
): Promise<void> => invoke("write_stagehand_config", { repoRoot, content });

// Config read command
export const readStagehandConfig = (
  repoRoot: string,
): Promise<StagehandConfig> => invoke("read_stagehand_config", { repoRoot });

// Command metrics (per-project slash command popularity)
export const getCommandMetrics = (
  repoRoot: string,
): Promise<Record<string, number>> =>
  invoke("get_command_metrics", { repoRoot });

// Terminal commands
export const createTerminal = (
  workspaceId: string,
  subDir?: string,
  command?: string,
): Promise<string> =>
  invoke("create_terminal", {
    workspaceId,
    ...(subDir != null && subDir !== "" && { subDir }),
    ...(command != null && command !== "" && { command }),
  });

export const startTerminal = (
  sessionId: string,
  cols: number,
  rows: number,
): Promise<void> => invoke("start_terminal", { sessionId, cols, rows });

export const destroyTerminal = (sessionId: string): Promise<void> =>
  invoke("destroy_terminal", { sessionId });

export const terminalWrite = (sessionId: string, data: string): Promise<void> =>
  invoke("terminal_write", { sessionId, data });

export const terminalResize = (
  sessionId: string,
  cols: number,
  rows: number,
): Promise<void> => invoke("terminal_resize", { sessionId, cols, rows });

// Simulator commands
export const listSimulators = (): Promise<SimulatorDevice[]> =>
  invoke("list_simulators");

export const bootSimulator = (udid: string): Promise<void> =>
  invoke("boot_simulator", { udid });

export const disconnectSimulator = (udid: string): Promise<void> =>
  invoke("disconnect_simulator", { udid });

export const startSimulatorCapture = (udid: string): Promise<number> =>
  invoke("start_simulator_capture", { udid });

export const stopSimulatorCapture = (): Promise<void> =>
  invoke("stop_simulator_capture");

export const simulatorTouch = (
  udid: string,
  x: number,
  y: number,
  eventType: number,
): Promise<void> => invoke("simulator_touch", { udid, x, y, eventType });

export const simulatorButton = (button: string): Promise<void> =>
  invoke("simulator_button", { button });

export const simulatorKeyboard = (
  keyCode: number,
  modifierFlags: number,
  isDown: boolean,
): Promise<void> =>
  invoke("simulator_keyboard", { keyCode, modifierFlags, isDown });
