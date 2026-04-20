/**
 * IPC handler registration — routes ipcMain.handle calls to service functions.
 *
 * Each handler unwraps the args object and delegates to the appropriate service.
 * Errors thrown in handlers automatically reject the renderer's promise
 * (errors are thrown as plain strings).
 */

import type {
  OnboardingStep,
  PrereqId,
  PrereqResult,
} from "./services/onboarding/types";
import type { OrganizationMember } from "./services/organization/models";
import { Menu, app, clipboard, dialog, ipcMain, nativeImage } from "electron";
import { promises as fs } from "node:fs";
import path from "node:path";
import { createLogger } from "../app/lib/logger";
import {
  closeFloatingSimulatorWindow,
  createFloatingSimulatorWindow,
  getMainWindow,
  markQuitConfirmedDespiteAgents,
} from "./main";
import {
  saveConversation,
  loadHistoryIndex,
  loadConversation,
  deleteHistoryEntry,
  searchChatHistory,
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
import { generateSessionTitle } from "./services/agent/sessionTitle";
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
import {
  listDevices,
  stopDevice,
  type DevicePlatform,
} from "./services/conductor/devices";
import { conductorLogStore, execConductor } from "./services/conductor/logger";
import { checkDependencies } from "./services/dependencies/check";
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
import {
  addSkipped as onboardingAddSkipped,
  argusDirPath,
  claudePing as onboardingClaudePing,
  cloneExample as onboardingCloneExample,
  completeOnboarding as onboardingComplete,
  ensureArgusDir as onboardingEnsureDir,
  getOnboardingState,
  listExamples as onboardingListExamples,
  readExistingArgusJson,
  registerProject as onboardingRegisterProject,
  resetOnboarding,
  runPrereqChecks,
  runPrereqFixer,
  saveDefaults as onboardingSaveDefaults,
  setLastStep,
  suggestArgusJson as onboardingSuggestArgusJson,
  writeArgusJson as onboardingWriteArgusJson,
} from "./services/onboarding";
import {
  createOrganization,
  updateOrganization,
  deleteOrganization,
  addRepoToOrganization,
  removeRepoFromOrganization,
  listOrganizations,
} from "./services/organization/manager";
import {
  deleteOrgTask,
  getOrgTask,
  listOrgTasks,
} from "./services/organizationTask/manager";
import {
  cancelOrgTask,
  startOrgTask,
} from "./services/organizationTask/orchestrator";
import { openExternalUrl, revealInFinder } from "./services/shell/operations";
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
  createRunTerminal,
  startTerminal,
  destroyTerminal,
  stopTerminal,
  terminalWrite,
  terminalResize,
} from "./services/terminal/multiplexer";
import { getUiState, setUiState } from "./services/uiState";
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
  getWorkspaceBranchDiff,
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
  readArgusConfig,
  writeArgusConfig,
  setWorkspaceBaseBranch,
  getWorkspaceCommitsAhead,
  getWorkspaceWorkingTreeState,
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
import { appState } from "./state";

type Args = Record<string, unknown>;

function emitNavState(workspaceId: string, nav: NavState): void {
  getMainWindow()?.webContents.send("browser_view:nav", {
    workspaceId,
    url: nav.url,
    canGoBack: nav.canGoBack,
    canGoForward: nav.canGoForward,
  });
}

async function resolveNativeImage(
  src: string,
): Promise<Electron.NativeImage | null> {
  if (src.startsWith("data:")) {
    return nativeImage.createFromDataURL(src);
  }
  if (src.startsWith("file://")) {
    const url = new URL(src);

    return nativeImage.createFromPath(decodeURIComponent(url.pathname));
  }
  if (src.startsWith("/")) {
    return nativeImage.createFromPath(src);
  }
  if (src.startsWith("http:") || src.startsWith("https:")) {
    const res = await fetch(src);
    const buf = Buffer.from(await res.arrayBuffer());

    return nativeImage.createFromBuffer(buf);
  }

  return null;
}

function inferImageExt(src: string, fallbackName: string): string {
  const m = src.match(/^data:image\/([a-zA-Z0-9+.-]+);/);
  if (m) {
    const t = m[1].toLowerCase();
    if (t === "jpeg") {
      return "jpg";
    }

    return t;
  }
  const ext = path.extname(fallbackName).replace(".", "").toLowerCase();

  return ext || "png";
}

function ensureExt(name: string, ext: string): string {
  if (path.extname(name)) {
    return name;
  }

  return `${name}.${ext}`;
}

/** Helper: register a handler that unwraps args. */
function handle(
  channel: string,
  handler: (args: Args) => Promise<unknown> | unknown,
): void {
  ipcMain.handle(channel, async (_event, args: Args = {}) => {
    try {
      return await handler(args);
    } catch (err) {
      createLogger(`ipc:${channel}`).error("handler threw:", err);
      throw err;
    }
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

  // Window
  handle("close_window", () => {
    getMainWindow()?.close();
  });

  // Quit-with-running-agents flow. Invoked by the renderer after the user
  // accepts the confirm dialog surfaced via `app:quit-request`. Stops each
  // running agent (best-effort, bounded by a short timeout) and then calls
  // app.quit(), which re-enters `before-quit` with the guard flag set.
  handle("app_confirm_quit", async () => {
    const runningIds: string[] = [];
    for (const [id, session] of appState.agents) {
      if (session.status === "running") {
        runningIds.push(id);
      }
    }

    const logger = createLogger("ipc:app_confirm_quit");
    logger.info(`stopping ${runningIds.length} running agents before quit`);

    // Run all stops with a short per-call timeout so a stuck agent can't hang
    // the quit. Failures are logged and ignored — we proceed with quit.
    await Promise.allSettled(
      runningIds.map(async (id) => {
        try {
          await Promise.race([
            stopAgent(id),
            new Promise<void>((resolve) => setTimeout(resolve, 1500)),
          ]);
        } catch (err) {
          logger.error(`stopAgent(${id}) threw during quit:`, err);
        }
      }),
    );

    markQuitConfirmedDespiteAgents();
    app.quit();
  });

  // Renderer cancelled the quit prompt — nothing to do server-side; the
  // `before-quit` handler already called `event.preventDefault()`.
  handle("app_cancel_quit", () => {
    createLogger("ipc:app_cancel_quit").info("user cancelled quit");
  });

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

  // Organizations
  handle("list_organizations", () => listOrganizations());
  handle("create_organization", (a) =>
    createOrganization({
      name: a.name as string,
      description: a.description as string | undefined,
      system_prompt: a.systemPrompt as string | undefined,
      accent: a.accent as string | undefined,
      members: a.members as OrganizationMember[] | undefined,
    }),
  );
  handle("update_organization", (a) =>
    updateOrganization(a.id as string, {
      name: a.name as string | undefined,
      description: a.description as string | undefined,
      system_prompt: a.systemPrompt as string | undefined,
      accent: a.accent as string | undefined,
      members: a.members as OrganizationMember[] | undefined,
    }),
  );
  handle("delete_organization", (a) => deleteOrganization(a.id as string));
  handle("add_repo_to_organization", (a) =>
    addRepoToOrganization(a.id as string, {
      repo_root: a.repoRoot as string,
      role: (a.role as string | undefined) ?? "",
    }),
  );
  handle("remove_repo_from_organization", (a) =>
    removeRepoFromOrganization(a.id as string, a.repoRoot as string),
  );

  // Organization tasks — cross-repo feature work that fans out to members.
  handle("list_org_tasks", (a) =>
    listOrgTasks(a.organizationId as string | undefined),
  );
  handle("get_org_task", (a) => getOrgTask(a.id as string));
  handle("start_org_task", (a) =>
    startOrgTask({
      organizationId: a.organizationId as string,
      title: a.title as string,
      prompt: a.prompt as string,
      scope: a.scope as { repo_root: string }[],
    }),
  );
  handle("cancel_org_task", (a) => cancelOrgTask(a.id as string));
  handle("delete_org_task", (a) => deleteOrgTask(a.id as string));

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
  handle("get_workspace_branch_diff", (a) =>
    getWorkspaceBranchDiff(a.id as string),
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
  handle("read_argus_config", (a) => readArgusConfig(a.repoRoot as string));
  handle("write_argus_config", (a) =>
    writeArgusConfig(a.repoRoot as string, a.content as string),
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
  handle("get_workspace_commits_ahead", (a) =>
    getWorkspaceCommitsAhead(a.id as string),
  );
  handle("get_workspace_review_state", async (a) => {
    const id = a.id as string;
    const [commitsAhead, treeState] = await Promise.all([
      getWorkspaceCommitsAhead(id),
      getWorkspaceWorkingTreeState(id),
    ]);

    return {
      commitsAhead,
      hasStaged: treeState.hasStaged,
      hasUncommitted: treeState.hasUncommitted,
    };
  });
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

  // Dependency / system probes
  handle("check_dependencies", () => checkDependencies());

  // UI state
  handle("ui_state_get", (a) => getUiState(a.key as string));
  handle("ui_state_set", (a) => {
    setUiState(a.key as string, a.value as string);

    return null;
  });

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
  handle("search_chat_history", (a) =>
    searchChatHistory(a.repoRoot as string, a.query as string),
  );
  handle("load_chat_history", (a) =>
    loadConversation(a.repoRoot as string, a.historyId as string),
  );
  handle("delete_chat_history", (a) =>
    deleteHistoryEntry(a.repoRoot as string, a.historyId as string),
  );
  handle("generate_session_title", (a) =>
    generateSessionTitle(a.firstMessage as string),
  );

  // Terminal commands.
  //
  // `create_terminal` deliberately does NOT accept a free-form `command`
  // parameter. Allowing the renderer (or any caller transitively reaching this
  // IPC) to inject an arbitrary `sh -c <command>` would turn any renderer
  // compromise (XSS via agent/file/MCP-controlled markdown) into full RCE.
  // Callers that need to start the workspace's configured run command must
  // use `create_run_terminal`, which resolves the command server-side from
  // `.argus.json`.
  handle("create_terminal", (a) =>
    createTerminal(a.workspaceId as string, a.subDir as string | undefined),
  );
  handle("create_run_terminal", (a) =>
    createRunTerminal(a.workspaceId as string, a.title as string | undefined),
  );
  handle("start_terminal", (a) =>
    startTerminal(a.sessionId as string, a.cols as number, a.rows as number),
  );
  handle("destroy_terminal", (a) => destroyTerminal(a.sessionId as string));
  handle("stop_terminal", (a) => stopTerminal(a.sessionId as string));
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
  handle("open_simulator_popout", (a) => {
    const udid = a.udid as string;
    const sim = appState.simulator;
    const mjpegPort = sim && sim.udid === udid ? (sim.mjpegPort ?? null) : null;
    const deviceName = sim && sim.udid === udid ? sim.deviceName : "Simulator";
    createFloatingSimulatorWindow({ udid, mjpegPort, deviceName });

    return Promise.resolve();
  });
  handle("close_simulator_popout", (a) => {
    closeFloatingSimulatorWindow(a.udid as string);

    return Promise.resolve();
  });

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
    await startScreencast(
      workspaceId,
      reservation.cdpPort,
      reservation.cdpTargetId,
      {
        maxWidth: 1440,
        maxHeight: 900,
      },
    );
    getMainWindow()?.webContents.send("browser:ensure_mounted", {
      sessionId: workspaceId,
    });
  });
  handle("browser_view_navigate", async (a) => {
    const workspaceId = a.workspaceId as string;
    const reservation = webBrowserPool.getReservation(workspaceId);
    if (!reservation) {
      return;
    }
    const nav = await conductorNavigate(reservation, a.url as string);
    emitNavState(workspaceId, nav);
  });
  handle("browser_view_back", async (a) => {
    const workspaceId = a.workspaceId as string;
    const reservation = webBrowserPool.getReservation(workspaceId);
    if (!reservation) {
      return;
    }
    const nav = await conductorGoBack(reservation);
    emitNavState(workspaceId, nav);
  });
  handle("browser_view_forward", async (a) => {
    const workspaceId = a.workspaceId as string;
    const reservation = webBrowserPool.getReservation(workspaceId);
    if (!reservation) {
      return;
    }
    const nav = await conductorGoForward(reservation);
    emitNavState(workspaceId, nav);
  });
  handle("browser_view_reload", async (a) => {
    const workspaceId = a.workspaceId as string;
    const reservation = webBrowserPool.getReservation(workspaceId);
    if (!reservation) {
      return;
    }
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
    if (!reservation) {
      return;
    }

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

  // Devices + conductor logs
  handle("list_devices", () => listDevices());
  handle("stop_device", (a) =>
    stopDevice(a.platform as DevicePlatform, a.deviceKey as string),
  );
  handle("list_conductor_logs", (a) =>
    conductorLogStore.list(a.deviceKey as string),
  );
  handle("run_conductor_command", async (a) => {
    const deviceKey = a.deviceKey as string;
    const args = a.args as string[];
    const hasDeviceFlag = args.some((x) => x === "--device" || x === "-d");
    const finalArgs = hasDeviceFlag ? args : [...args, "--device", deviceKey];
    await execConductor(deviceKey, finalArgs);
  });

  // Shell
  handle("reveal_in_finder", (a) => revealInFinder(a.path as string));
  handle("open_external_url", (a) => openExternalUrl(a.url as string));

  // Extensions
  handle("discover_extensions", () => discoverExtensions());

  // Image context menu
  handle("show_image_context_menu", async (a) => {
    const win = getMainWindow();
    if (!win) {
      return;
    }
    const src = a.src as string;
    const suggestedName = (a.suggestedName as string) || "image.png";
    const image = await resolveNativeImage(src);
    if (!image || image.isEmpty()) {
      return;
    }
    const ext = inferImageExt(src, suggestedName);
    const menu = Menu.buildFromTemplate([
      {
        label: "Copy Image",
        click: () => {
          clipboard.writeImage(image);
        },
      },
      {
        label: "Save Image As\u2026",
        click: async () => {
          const result = await dialog.showSaveDialog(win, {
            defaultPath: ensureExt(suggestedName, ext),
            filters: [
              {
                name: "Images",
                extensions: ["png", "jpg", "jpeg", "gif", "webp", "bmp"],
              },
            ],
          });
          if (result.canceled || !result.filePath) {
            return;
          }
          const outExt = path.extname(result.filePath).toLowerCase();
          const buffer =
            outExt === ".jpg" || outExt === ".jpeg"
              ? image.toJPEG(95)
              : image.toPNG();
          await fs.writeFile(result.filePath, buffer);
        },
      },
    ]);
    menu.popup({ window: win });
  });

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

  // Onboarding
  handle("onboarding_get_state", () => getOnboardingState());
  handle("onboarding_ensure_argus_dir", () => ({
    path: onboardingEnsureDir(),
  }));
  handle("onboarding_set_last_step", (a) => {
    setLastStep(a.step as OnboardingStep);
  });
  handle("onboarding_add_skipped", (a) => {
    onboardingAddSkipped(a.id as string);
  });
  handle("onboarding_check_prereqs", async (a) => {
    const ids = a.ids as PrereqId[] | undefined;

    return runPrereqChecks((update: PrereqResult) => {
      getMainWindow()?.webContents.send("onboarding:prereq_update", update);
    }, ids);
  });
  handle("onboarding_run_fixer", (a) =>
    runPrereqFixer(a.id as PrereqId, {
      gitName: a.gitName as string | undefined,
      gitEmail: a.gitEmail as string | undefined,
    }),
  );
  handle("onboarding_claude_ping", () => onboardingClaudePing());
  handle("onboarding_save_defaults", (a) =>
    onboardingSaveDefaults({
      model: a.model as string | undefined,
      permissionMode: a.permissionMode as string | undefined,
      worktreeRoot: a.worktreeRoot as string | undefined,
    }),
  );
  handle("onboarding_list_examples", () => onboardingListExamples());
  handle("onboarding_clone_example", (a) =>
    onboardingCloneExample(a.slug as string),
  );
  handle("onboarding_register_project", (a) => {
    onboardingRegisterProject(a.path as string);
  });
  handle("onboarding_suggest_argus_json", (a) =>
    onboardingSuggestArgusJson(a.path as string),
  );
  handle("onboarding_read_existing_argus_json", (a) =>
    readExistingArgusJson(a.path as string),
  );
  handle("onboarding_write_argus_json", (a) => {
    onboardingWriteArgusJson(
      a.path as string,
      a.config as Record<string, unknown>,
    );
  });
  handle("onboarding_complete", () => {
    onboardingComplete();
  });
  handle("onboarding_reset", () => {
    resetOnboarding();
  });
  handle("onboarding_argus_dir_path", () => argusDirPath());
}
