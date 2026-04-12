/**
 * Typed IPC wrappers for all Electron backend commands.
 *
 * All renderer → main communication goes through these functions.
 * Components should never call `window.stagehand.invoke()` directly.
 */

import type { ChatHistoryEntry, SavedConversation } from "./chatHistory";
import type {
  AgentStatus,
  AndroidDevice,
  BranchList,
  DirEntry,
  FileStat,
  MentionPathResult,
  SimulatorDevice,
  StagehandConfig,
  Workspace,
} from "./types";

declare global {
  interface Window {
    stagehand: {
      invoke: <T>(
        channel: string,
        args?: Record<string, unknown>,
      ) => Promise<T>;
      on: <T>(event: string, callback: (payload: T) => void) => () => void;
      send: (channel: string, args?: Record<string, unknown>) => void;
    };
  }
}

function invoke<T>(
  channel: string,
  args?: Record<string, unknown>,
): Promise<T> {
  return window.stagehand.invoke<T>(channel, args);
}

/** Fire-and-forget IPC — skips the invoke reply round-trip. */
export function send(channel: string, args?: Record<string, unknown>): void {
  window.stagehand.send(channel, args);
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

export const listAllBranches = (repoRoot: string): Promise<BranchList> =>
  invoke("list_all_branches", { repoRoot });

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
  baseBranch?: string,
): Promise<Workspace> =>
  invoke("create_workspace", {
    repoRoot,
    branch,
    description,
    useExistingBranch: useExistingBranch ?? false,
    baseBranch,
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
  abbreviatedHash: string;
  author: string;
  authorEmail: string;
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

export const listWorkspaceFiles = (id: string): Promise<string[]> =>
  invoke("list_workspace_files", { id });

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

// Agent commands
export const checkClaudeCli = (): Promise<string> => invoke("check_claude_cli");

export const startAgent = (
  workspaceId: string,
  model?: string,
  permissionMode?: string,
  resumeSessionId?: string,
  appendSystemPrompt?: string,
): Promise<AgentStatus> =>
  invoke("start_agent", {
    workspaceId,
    ...(model != null && model !== "" && { model }),
    ...(permissionMode != null && permissionMode !== "" && { permissionMode }),
    ...(resumeSessionId != null &&
      resumeSessionId !== "" && { resumeSessionId }),
    ...(appendSystemPrompt != null &&
      appendSystemPrompt !== "" && { appendSystemPrompt }),
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

export const loadChatHistory = (
  repoRoot: string,
  historyId: string,
): Promise<SavedConversation | null> =>
  invoke("load_chat_history", { repoRoot, historyId });

export const deleteChatHistory = (
  repoRoot: string,
  historyId: string,
): Promise<void> => invoke("delete_chat_history", { repoRoot, historyId });

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
export const checkIosTools = (): Promise<void> => invoke("check_ios_tools");

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

// Browser commands — Playwright Chromium-backed embedded browser per workspace.

export const browserViewEnsure = (workspaceId: string): Promise<void> =>
  invoke("browser_view_ensure", { workspaceId });

export const browserViewNavigate = (
  workspaceId: string,
  url: string,
): Promise<void> => invoke("browser_view_navigate", { workspaceId, url });

export const browserViewBack = (workspaceId: string): Promise<void> =>
  invoke("browser_view_back", { workspaceId });

export const browserViewForward = (workspaceId: string): Promise<void> =>
  invoke("browser_view_forward", { workspaceId });

export const browserViewReload = (workspaceId: string): Promise<void> =>
  invoke("browser_view_reload", { workspaceId });

export const browserViewDestroy = (workspaceId: string): Promise<void> =>
  invoke("browser_view_destroy", { workspaceId });

export const browserMouseEvent = (
  workspaceId: string,
  type: "click" | "down" | "move" | "up",
  x: number,
  y: number,
  button?: "left" | "middle" | "right",
): Promise<void> =>
  invoke("browser_mouse_event", { workspaceId, type, x, y, button });

export const browserKeyboardEvent = (
  workspaceId: string,
  type: "down" | "press" | "up",
  key: string,
): Promise<void> =>
  invoke("browser_keyboard_event", { workspaceId, type, key });

export const browserWheelEvent = (
  workspaceId: string,
  x: number,
  y: number,
  deltaX: number,
  deltaY: number,
): Promise<void> =>
  invoke("browser_wheel_event", { workspaceId, x, y, deltaX, deltaY });

export interface BrowserPresetConfig {
  internalHeight: number;
  internalWidth: number;
  screenPosition?: "desktop" | "mobile";
  userAgent?: string;
}

export const browserUpdatePreset = (
  workspaceId: string,
  preset: BrowserPresetConfig,
): Promise<void> => invoke("browser_update_preset", { workspaceId, preset });

export const browserGetMjpegPort = (): Promise<number> =>
  invoke("browser_get_mjpeg_port");

// Shell commands
export const revealInFinder = (path: string): Promise<void> =>
  invoke("reveal_in_finder", { path });
