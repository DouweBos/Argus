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
  ConductorLogEntry,
  DependencyReport,
  DeviceInfo,
  DevicePlatform,
  DirEntry,
  ExampleProject,
  FileStat,
  MentionPathResult,
  OnboardingConfigFile,
  OnboardingDefaults,
  OnboardingStep,
  OrgTask,
  Organization,
  OrganizationMember,
  PrereqId,
  PrereqResult,
  SimulatorDevice,
  Session,
  UserProjectSettings,
} from "./types";

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
    };
  }
}

/**
 * Check whether a session id refers to an optimistic placeholder that hasn't
 * been created on the backend yet. Placeholders are inserted into the session
 * list the moment the user submits the new-session dialog so the card renders
 * immediately, while `create_session` is still generating the branch name and
 * setting up the worktree in the background. Any backend call keyed by this
 * id would throw "Session not found" until replacement.
 */
export function isPendingSessionId(id: string | null | undefined): boolean {
  return typeof id === "string" && id.startsWith("pending-");
}

function invoke<T>(
  channel: string,
  args?: Record<string, unknown>,
): Promise<T> {
  // Short-circuit any session-scoped call that's targeting a placeholder
  // session. Callers of these wrappers already swallow errors (the backend
  // may legitimately not have the session yet during setup), so returning
  // a rejection here matches the existing "session not found" contract
  // without spamming the main-process logs.
  if (args) {
    const candidate = (args["id"] ?? args["sessionId"]) as unknown;
    if (typeof candidate === "string" && isPendingSessionId(candidate)) {
      return Promise.reject(new Error("Session is pending creation"));
    }
  }

  return window.argus.invoke<T>(channel, args);
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

// Session commands
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

export const listSessions = (repoRoot: string): Promise<Session[]> =>
  invoke("list_sessions", { repoRoot });

export const createSession = (
  repoRoot: string,
  branch: string,
  description: string,
  useExistingBranch?: boolean,
  baseBranch?: string,
): Promise<Session> =>
  invoke("create_session", {
    repoRoot,
    branch,
    description,
    useExistingBranch: useExistingBranch ?? false,
    baseBranch,
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

export const getSessionDiff = (id: string): Promise<string> =>
  invoke("get_session_diff", { id });

export const getSessionStatus = (id: string): Promise<string> =>
  invoke("get_session_status", { id });

export const getSessionFullDiff = (id: string): Promise<string> =>
  invoke("get_session_full_diff", { id });

export const getSessionBranchDiff = (id: string): Promise<string> =>
  invoke("get_session_branch_diff", { id });

export const getSessionStagedDiff = (id: string): Promise<string> =>
  invoke("get_session_staged_diff", { id });

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

export const getSessionCommitsAhead = (id: string): Promise<number> =>
  invoke("get_session_commits_ahead", { id });

export const getSessionReviewState = (
  id: string,
): Promise<{
  commitsAhead: number;
  hasStaged: boolean;
  hasUncommitted: boolean;
}> => invoke("get_session_review_state", { id });

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
): Promise<AgentStatus> =>
  invoke("start_agent", {
    sessionId,
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

export const listAgents = (sessionId: string): Promise<AgentStatus[]> =>
  invoke("list_agents", { sessionId });

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
): Promise<string> =>
  invoke("create_terminal", {
    sessionId,
    ...(subDir != null && subDir !== "" && { subDir }),
  });

export interface CreateRunTerminalResult {
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

// Shell commands
export const revealInFinder = (path: string): Promise<void> =>
  invoke("reveal_in_finder", { path });

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

export const saveOnboardingDefaults = (
  updates: Partial<OnboardingDefaults>,
): Promise<OnboardingDefaults> =>
  invoke("onboarding_save_defaults", updates as Record<string, unknown>);

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
