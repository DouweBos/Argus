/**
 * IPC handler registration — routes ipcMain.handle calls to service functions.
 *
 * Each handler unwraps the args object and delegates to the appropriate service.
 * Errors thrown in handlers automatically reject the renderer's promise
 * (errors are thrown as plain strings).
 */

import { dialog, ipcMain } from "electron";
import { getMainWindow } from "./main";
import { appState } from "./state";
import {
  saveConversation,
  loadHistoryIndex,
  loadConversation,
  deleteHistoryEntry,
} from "./services/agent/chatHistory";
import {
  checkClaudeCli,
  startAgent,
  stopAgent,
  interruptAgent,
  sendAgentMessage,
  listAgents,
  respondToPermission,
  setAgentModel,
  setAgentPermissionMode,
} from "./services/agent/claude";
import {
  startScreencast,
  stopScreencast,
  restartScreencast,
} from "./services/browser/cdpScreencast";
import {
  type BrowserPreset,
  type NavState,
  mouseEvent as conductorMouseEvent,
  keyboardEvent as conductorKeyboardEvent,
  wheelEvent as conductorWheelEvent,
  navigate as conductorNavigate,
  goBack as conductorGoBack,
  goForward as conductorGoForward,
  reload as conductorReload,
  setViewport as conductorSetViewport,
} from "./services/browser/conductorInput";
import { getMjpegPort } from "./services/browser/mjpegServer";
import { webBrowserPool } from "./services/browser/pool";
import { discoverExtensions } from "./services/extensions/loader";
import {
  listDirectory,
  listWorkspaceFiles,
  resolveMentionPath,
  readFile,
  writeFile,
  statFile,
  statPath,
  readPath,
  writePath,
  listPath,
  mkdirPath,
  deletePath,
  renamePath,
} from "./services/file/operations";
import { revealInFinder } from "./services/shell/operations";
import {
  checkAndroidTools,
  listAndroidDevices,
  listAvds,
  bootAndroidEmulator,
  startAndroidCapture,
  stopAndroidCapture,
  disconnectAndroidDevice,
  androidTouch,
  androidKeyboard,
  androidButton,
} from "./services/simulator/android";
import {
  checkIosTools,
  listSimulators,
  bootSimulator,
  disconnectSimulator,
  activeSimulator,
  startSimulatorCapture,
  stopSimulatorCapture,
  simulatorTouch,
  simulatorButton,
  simulatorKeyboard,
} from "./services/simulator/ios";
import {
  createTerminal,
  startTerminal,
  destroyTerminal,
  terminalWrite,
  terminalResize,
} from "./services/terminal/multiplexer";
import { loadCommandMetrics } from "./services/workspace/commandMetrics";
import {
  addRepoRoot,
  removeRepoRoot,
  listWorkspaces,
  createWorkspace,
  createHeadWorkspace,
  deleteWorkspace,
} from "./services/workspace/manager";
import {
  getRepoBranch,
  listBranches,
  listAllBranches,
  checkoutBranch,
  getWorkspaceDiff,
  getWorkspaceFullDiff,
  getWorkspaceStagedDiff,
  getWorkspaceUntrackedDiff,
  getWorkspaceStatus,
  stageFile,
  stageAll,
  unstageFile,
  unstageAll,
  discardFile,
  stageHunk,
  unstageHunk,
  discardHunk,
  gitCommit,
  getGitAuthor,
  getLastCommitMessage,
  getLastCommitHash,
  watchWorkspace,
  unwatchWorkspace,
  pauseAllWatchers,
  resumeAllWatchers,
  readStagehandConfig,
  writeStagehandConfig,
  setWorkspaceBaseBranch,
  getWorkspaceConflicts,
  mergeWorkspaceIntoBase,
  gitPull,
  gitPush,
  gitFetch,
  gitStash,
  gitStashPop,
  gitLog,
  gitShowCommit,
  gitStashList,
  gitStashShow,
  gitStashApply,
  gitStashDrop,
} from "./services/workspace/workspaceOps";

type Args = Record<string, unknown>;

function emitNavState(workspaceId: string, nav: NavState): void {
  getMainWindow()?.webContents.send("browser_view:nav", {
    workspaceId,
    url: nav.url,
    canGoBack: nav.canGoBack,
    canGoForward: nav.canGoForward,
  });
}

/** Helper: register a handler that unwraps args. */
function handle(
  channel: string,
  handler: (args: Args) => Promise<unknown> | unknown,
): void {
  ipcMain.handle(channel, async (_event, args: Args = {}) => {
    return handler(args);
  });
}

export function registerIpcHandlers(): void {
  // File commands
  handle("list_directory", (a) =>
    listDirectory(a.id as string, a.relativePath as string),
  );
  handle("read_file", (a) =>
    readFile(a.id as string, a.relativePath as string),
  );
  handle("write_file", (a) =>
    writeFile(a.id as string, a.relativePath as string, a.content as string),
  );
  handle("stat_file", (a) =>
    statFile(a.id as string, a.relativePath as string),
  );
  handle("list_workspace_files", (a) => listWorkspaceFiles(a.id as string));
  handle("resolve_mention_path", (a) =>
    resolveMentionPath(a.id as string, a.query as string),
  );

  // Absolute-path file operations (used by VS Code filesystem provider)
  handle("stat_path", (a) => statPath(a.path as string));
  handle("read_path", (a) => readPath(a.path as string));
  handle("write_path", (a) => writePath(a.path as string, a.content as string));
  handle("list_path", (a) => listPath(a.path as string));
  handle("mkdir_path", (a) => mkdirPath(a.path as string));
  handle("delete_path", (a) => deletePath(a.path as string));
  handle("rename_path", (a) => renamePath(a.from as string, a.to as string));

  // Workspace CRUD
  handle("add_repo_root", (a) => addRepoRoot(a.path as string));
  handle("remove_repo_root", (a) => removeRepoRoot(a.path as string));
  handle("list_workspaces", (a) => listWorkspaces(a.repoRoot as string));
  handle("create_workspace", (a) =>
    createWorkspace(
      a.repoRoot as string,
      a.branch as string,
      a.description as string,
      a.useExistingBranch as boolean | undefined,
      a.baseBranch as string | undefined,
    ),
  );
  handle("create_head_workspace", (a) =>
    createHeadWorkspace(a.repoRoot as string),
  );
  handle("delete_workspace", (a) =>
    deleteWorkspace(
      a.id as string,
      a.shouldDeleteBranch as boolean | undefined,
    ),
  );

  // Workspace ops
  handle("get_repo_branch", (a) => getRepoBranch(a.repoRoot as string));
  handle("list_branches", (a) => listBranches(a.repoRoot as string));
  handle("list_all_branches", (a) => listAllBranches(a.repoRoot as string));
  handle("checkout_branch", (a) =>
    checkoutBranch(a.repoRoot as string, a.branch as string),
  );
  handle("get_workspace_diff", (a) => getWorkspaceDiff(a.id as string));
  handle("get_workspace_full_diff", (a) =>
    getWorkspaceFullDiff(a.id as string),
  );
  handle("get_workspace_staged_diff", (a) =>
    getWorkspaceStagedDiff(a.id as string),
  );
  handle("get_workspace_untracked_diff", (a) =>
    getWorkspaceUntrackedDiff(a.id as string),
  );
  handle("get_workspace_status", (a) => getWorkspaceStatus(a.id as string));
  handle("stage_file", (a) => stageFile(a.id as string, a.filePath as string));
  handle("stage_all", (a) => stageAll(a.id as string));
  handle("unstage_file", (a) =>
    unstageFile(a.id as string, a.filePath as string),
  );
  handle("unstage_all", (a) => unstageAll(a.id as string));
  handle("discard_file", (a) =>
    discardFile(a.id as string, a.filePath as string),
  );
  handle("stage_hunk", (a) => stageHunk(a.id as string, a.patch as string));
  handle("unstage_hunk", (a) => unstageHunk(a.id as string, a.patch as string));
  handle("discard_hunk", (a) => discardHunk(a.id as string, a.patch as string));
  handle("git_commit", (a) =>
    gitCommit(a.id as string, a.message as string, a.amend as boolean),
  );
  handle("get_git_author", (a) => getGitAuthor(a.id as string));
  handle("get_last_commit_message", (a) =>
    getLastCommitMessage(a.id as string),
  );
  handle("get_last_commit_hash", (a) => getLastCommitHash(a.id as string));
  handle("watch_workspace", (a) => watchWorkspace(a.id as string));
  handle("unwatch_workspace", (a) => unwatchWorkspace(a.id as string));
  handle("pause_all_watchers", () => pauseAllWatchers());
  handle("resume_all_watchers", () => resumeAllWatchers());
  handle("read_stagehand_config", (a) =>
    readStagehandConfig(a.repoRoot as string),
  );
  handle("write_stagehand_config", (a) =>
    writeStagehandConfig(a.repoRoot as string, a.content as string),
  );
  handle("get_command_metrics", (a) =>
    loadCommandMetrics(a.repoRoot as string),
  );
  handle("set_workspace_base_branch", (a) =>
    setWorkspaceBaseBranch(a.id as string, a.baseBranch as string),
  );
  handle("get_workspace_conflicts", (a) =>
    getWorkspaceConflicts(a.id as string),
  );
  handle("merge_workspace_into_base", (a) =>
    mergeWorkspaceIntoBase(a.id as string),
  );
  handle("git_pull", (a) =>
    gitPull(
      a.id as string,
      a.remoteBranch as string | undefined,
      a.rebase as boolean | undefined,
    ),
  );
  handle("git_push", (a) => gitPush(a.id as string));
  handle("git_fetch", (a) => gitFetch(a.id as string));
  handle("git_stash", (a) => gitStash(a.id as string));
  handle("git_stash_pop", (a) => gitStashPop(a.id as string));
  handle("git_log", (a) =>
    gitLog(
      a.id as string,
      (a.count as number | undefined) ?? 100,
      (a.allBranches as boolean | undefined) ?? true,
    ),
  );
  handle("git_show_commit", (a) =>
    gitShowCommit(a.id as string, a.commitHash as string),
  );
  handle("git_stash_list", (a) => gitStashList(a.id as string));
  handle("git_stash_show", (a) =>
    gitStashShow(a.id as string, a.stashIndex as number),
  );
  handle("git_stash_apply", (a) =>
    gitStashApply(a.id as string, a.stashIndex as number),
  );
  handle("git_stash_drop", (a) =>
    gitStashDrop(a.id as string, a.stashIndex as number),
  );

  // Agent commands
  handle("check_claude_cli", () => checkClaudeCli());
  handle("start_agent", (a) =>
    startAgent(
      a.workspaceId as string,
      a.model as string | undefined,
      a.permissionMode as string | undefined,
      a.resumeSessionId as string | undefined,
      a.appendSystemPrompt as string | undefined,
    ),
  );
  handle("stop_agent", (a) => stopAgent(a.agentId as string));
  handle("interrupt_agent", (a) => interruptAgent(a.agentId as string));
  handle("send_agent_message", (a) =>
    sendAgentMessage(
      a.agentId as string,
      a.message as string,
      a.images as { data: string; media_type: string }[] | undefined,
    ),
  );
  handle("list_agents", (a) => listAgents(a.workspaceId as string));
  handle("respond_to_permission", (a) =>
    respondToPermission(
      a.agentId as string,
      a.toolUseId as string,
      a.decision as "allow" | "deny",
      a.allowRule as string | undefined,
      a.allowAll as boolean | undefined,
      a.denyMessage as string | undefined,
    ),
  );
  handle("set_agent_model", (a) =>
    setAgentModel(a.agentId as string, a.model as string),
  );
  handle("set_agent_permission_mode", (a) =>
    setAgentPermissionMode(a.agentId as string, a.mode as string),
  );

  // Chat history commands
  handle("save_chat_history", (a) =>
    saveConversation(
      a.repoRoot as string,
      a.conversation as Parameters<typeof saveConversation>[1],
    ),
  );
  handle("list_chat_history", (a) => loadHistoryIndex(a.repoRoot as string));
  handle("load_chat_history", (a) =>
    loadConversation(a.repoRoot as string, a.historyId as string),
  );
  handle("delete_chat_history", (a) =>
    deleteHistoryEntry(a.repoRoot as string, a.historyId as string),
  );

  // Terminal commands
  handle("create_terminal", (a) =>
    createTerminal(
      a.workspaceId as string,
      a.subDir as string | undefined,
      a.command as string | undefined,
    ),
  );
  handle("start_terminal", (a) =>
    startTerminal(a.sessionId as string, a.cols as number, a.rows as number),
  );
  handle("destroy_terminal", (a) => destroyTerminal(a.sessionId as string));
  handle("terminal_write", (a) =>
    terminalWrite(a.sessionId as string, a.data as string),
  );
  handle("terminal_resize", (a) =>
    terminalResize(a.sessionId as string, a.cols as number, a.rows as number),
  );

  // Simulator commands
  handle("check_ios_tools", () => checkIosTools());
  handle("list_simulators", () => listSimulators());
  handle("boot_simulator", (a) => bootSimulator(a.udid as string));
  handle("disconnect_simulator", (a) => disconnectSimulator(a.udid as string));
  handle("active_simulator", () => activeSimulator());
  handle("start_simulator_capture", (a) =>
    startSimulatorCapture(a.udid as string),
  );
  handle("stop_simulator_capture", () => stopSimulatorCapture());
  handle("simulator_touch", (a) =>
    simulatorTouch(
      a.udid as string,
      a.x as number,
      a.y as number,
      a.eventType as number,
    ),
  );
  handle("simulator_button", (a) => simulatorButton(a.button as string));
  handle("simulator_keyboard", (a) =>
    simulatorKeyboard(
      a.keyCode as number,
      a.modifierFlags as number,
      a.isDown as boolean,
    ),
  );

  // Android device commands
  handle("check_android_tools", () => checkAndroidTools());
  handle("list_android_devices", () => listAndroidDevices());
  handle("list_avds", () => listAvds());
  handle("boot_android_emulator", (a) =>
    bootAndroidEmulator(a.avdName as string),
  );
  handle("start_android_capture", (a) =>
    startAndroidCapture(a.serial as string),
  );
  handle("stop_android_capture", () => stopAndroidCapture());
  handle("disconnect_android_device", (a) =>
    disconnectAndroidDevice(a.serial as string),
  );
  handle("android_touch", (a) =>
    androidTouch(
      a.serial as string,
      a.x as number,
      a.y as number,
      a.eventType as number,
    ),
  );
  handle("android_keyboard", (a) =>
    androidKeyboard(
      a.keyCode as number,
      a.metaState as number,
      a.isDown as boolean,
    ),
  );
  handle("android_button", (a) => androidButton(a.button as string));

  // Browser — Conductor-backed Chromium per workspace. Pool manages daemons;
  // screencast via raw CDP WebSocket; input forwarded through Conductor HTTP.
  handle("browser_view_ensure", async (a) => {
    const workspaceId = a.workspaceId as string;
    let reservation = webBrowserPool.getReservation(workspaceId);
    if (!reservation) {
      reservation = await webBrowserPool.acquireBrowser(workspaceId);
    }
    appState.browserSessions.set(workspaceId, {
      id: workspaceId,
      url: "",
      webContentsId: null,
    });
    await startScreencast(workspaceId, reservation.cdpPort, reservation.cdpTargetId, {
      maxWidth: 1440,
      maxHeight: 900,
    });
    getMainWindow()?.webContents.send("browser:ensure_mounted", {
      sessionId: workspaceId,
    });
  });
  handle("browser_view_navigate", async (a) => {
    const workspaceId = a.workspaceId as string;
    const reservation = webBrowserPool.getReservation(workspaceId);
    if (!reservation) return;
    const nav = await conductorNavigate(reservation, a.url as string);
    emitNavState(workspaceId, nav);
  });
  handle("browser_view_back", async (a) => {
    const workspaceId = a.workspaceId as string;
    const reservation = webBrowserPool.getReservation(workspaceId);
    if (!reservation) return;
    const nav = await conductorGoBack(reservation);
    emitNavState(workspaceId, nav);
  });
  handle("browser_view_forward", async (a) => {
    const workspaceId = a.workspaceId as string;
    const reservation = webBrowserPool.getReservation(workspaceId);
    if (!reservation) return;
    const nav = await conductorGoForward(reservation);
    emitNavState(workspaceId, nav);
  });
  handle("browser_view_reload", async (a) => {
    const workspaceId = a.workspaceId as string;
    const reservation = webBrowserPool.getReservation(workspaceId);
    if (!reservation) return;
    const nav = await conductorReload(reservation);
    emitNavState(workspaceId, nav);
  });
  handle("browser_view_destroy", async (a) => {
    const workspaceId = a.workspaceId as string;
    await stopScreencast(workspaceId);
    appState.browserSessions.delete(workspaceId);
    await webBrowserPool.releaseBrowser(workspaceId);
  });
  handle("browser_mouse_event", async (a) => {
    const reservation = webBrowserPool.getReservation(a.workspaceId as string);
    if (reservation) {
      await conductorMouseEvent(
        reservation,
        a.type as "click" | "down" | "move" | "up",
        a.x as number,
        a.y as number,
        a.button as "left" | "middle" | "right" | undefined,
      );
    }
  });
  handle("browser_keyboard_event", async (a) => {
    const reservation = webBrowserPool.getReservation(a.workspaceId as string);
    if (reservation) {
      await conductorKeyboardEvent(
        reservation,
        a.type as "down" | "press" | "up",
        a.key as string,
      );
    }
  });
  handle("browser_wheel_event", async (a) => {
    const reservation = webBrowserPool.getReservation(a.workspaceId as string);
    if (reservation) {
      await conductorWheelEvent(
        reservation,
        a.x as number,
        a.y as number,
        a.deltaX as number,
        a.deltaY as number,
      );
    }
  });
  handle("browser_update_preset", async (a) => {
    const workspaceId = a.workspaceId as string;
    const preset = a.preset as BrowserPreset;
    const reservation = webBrowserPool.getReservation(workspaceId);
    if (!reservation) return;

    const isMobile = preset.screenPosition === "mobile";
    const newTargetId = await conductorSetViewport(reservation, {
      width: preset.internalWidth,
      height: preset.internalHeight,
      userAgent: preset.userAgent,
      isMobile,
      deviceScaleFactor: isMobile ? 2 : 1,
    });

    if (newTargetId) {
      reservation.cdpTargetId = newTargetId;
      await restartScreencast(workspaceId, reservation.cdpPort, newTargetId, {
        maxWidth: preset.internalWidth,
        maxHeight: preset.internalHeight,
      });
    }
  });
  handle("browser_get_mjpeg_port", () => getMjpegPort());

  // Shell
  handle("reveal_in_finder", (a) => revealInFinder(a.path as string));

  // Extensions
  handle("discover_extensions", () => discoverExtensions());

  // Dialog
  handle("show_open_dialog", async () => {
    const win = getMainWindow();
    if (!win) {
      return null;
    }
    const result = await dialog.showOpenDialog(win, {
      properties: ["openDirectory"],
      title: "Select Repository Root",
    });
    if (result.canceled || result.filePaths.length === 0) {
      return null;
    }

    return result.filePaths[0];
  });
}
