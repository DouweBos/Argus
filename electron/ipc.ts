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
import type { ToolId } from "./services/tools/types";
import { Menu, app, clipboard, dialog, ipcMain, nativeImage } from "electron";
import { promises as fs } from "node:fs";
import path from "node:path";
import { createLogger } from "../app/lib/logger";
import { broadcastToRenderers } from "./broadcast";
import {
  closeFloatingAgentWindow,
  closeFloatingSimulatorWindow,
  createFloatingAgentWindow,
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
  createCheckpoint,
  deleteCheckpoint,
  restoreCheckpoint,
} from "./services/agent/checkpoints";
import {
  checkClaudeCli,
  claimPrewarmAgent,
  discardPrewarmAgent,
  prewarmAgent,
  restoreAgentAtTurn,
  startAgent,
  stopAgent,
  interruptAgent,
  sendAgentMessage,
  listAgents,
  respondToPermission,
  setAgentEffort,
  setAgentModel,
  setAgentPermissionMode,
} from "./services/agent/claude";
import {
  loadAppSettings,
  saveAppSettings,
  type AppSettings,
} from "./services/appSettings/store";
import { registerAreaCaptureHandlers } from "./services/areaCapture";
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
  listDebugStreams,
  runDebugCommand,
  startDebugStream,
  stopDebugStream,
} from "./services/conductor/debug";
import {
  listDevices,
  stopDevice,
  type DevicePlatform,
} from "./services/conductor/devices";
import { conductorLogStore, execConductor } from "./services/conductor/logger";
import { openDeepLink } from "./services/conductor/openLink";
import { checkDependencies } from "./services/dependencies/check";
import { discoverExtensions } from "./services/extensions/loader";
import {
  listDirectory,
  listSessionFiles,
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
import { listGhIssues } from "./services/github/issues";
import {
  ghPrClose,
  ghPrComment,
  ghPrCreate,
  ghPrMerge,
  type MergeStrategy,
} from "./services/github/prActions";
import {
  getPullRequestDetail,
  getPullRequestDiff,
} from "./services/github/prDetail";
import { listInterestingPullRequests } from "./services/github/pullRequests";
import { captureUi } from "./services/inspection/capture";
import {
  hideLauncher,
  isLauncherEnabled,
  launcherStatus,
  markLauncherRendererReady,
  setLauncherEnabled,
  showLauncher,
  toggleLauncher,
  updateLauncherAccelerator,
} from "./services/launcher";
import {
  listRunnerOnboardingSteps,
  listRunners as listLlmRunners,
} from "./services/llm/registry";
import { generateChatTitle } from "./services/llm/titleGenerator";
import { testMcpServer } from "./services/mcp/connectivity";
import {
  authenticate,
  cancelAuthentication,
  signOut,
} from "./services/mcp/oauth";
import { listAuthorized, loadToken } from "./services/mcp/oauthStore";
import { collectAllProjects } from "./services/mcp/projects";
import { listInheritedMcpServers } from "./services/mcp/userConfig";
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
  refineArgusJsonWithClaude,
  registerProject as onboardingRegisterProject,
  resetOnboarding,
  runPrereqChecks,
  runPrereqFixer,
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
import { reconfigureAutoFetchForRepo } from "./services/session/autoFetch";
import { loadCommandMetrics } from "./services/session/commandMetrics";
import { gitAmendTip } from "./services/session/gitAmend";
import {
  gitBisectBad,
  gitBisectGood,
  gitBisectReset,
  gitBisectSkip,
  gitBisectStart,
  gitBisectStatus,
} from "./services/session/gitBisect";
import { gitBlameFile } from "./services/session/gitBlame";
import { gitReadBlobAtRef } from "./services/session/gitBlob";
import {
  gitCheckout,
  gitCreateBranch,
  gitDeleteBranch,
  gitDiscardAndCheckout,
  gitListLocalBranches,
  gitListRemoteBranches,
  gitMergeBranch,
  gitRebaseOnto,
  gitRenameBranch,
  gitSetUpstream,
  gitStashAndCheckout,
} from "./services/session/gitBranchOps";
import { gitCompareBranches } from "./services/session/gitCompare";
import { gitGetConfig, gitSetConfig } from "./services/session/gitConfig";
import {
  gitAbortCherryPick,
  gitAbortMerge,
  gitAbortRebase,
  gitContinueCherryPick,
  gitContinueMerge,
  gitContinueRebase,
  gitGetConflict,
  gitMarkResolved,
  gitSkipRebase,
  gitWriteConflictMerged,
} from "./services/session/gitConflicts";
import {
  checkSshKeys,
  getGlobalCredentialHelper,
  setGlobalCredentialHelper,
} from "./services/session/gitCredentials";
import {
  addToGitignore,
  gitDiscardFile,
  gitDiscardHunk,
  gitDiscardLines,
  gitUntrackFile,
} from "./services/session/gitDiscard";
import { GitError, serializeGitError } from "./services/session/gitError";
import {
  gitCherryPick,
  gitReset,
  gitRevert,
} from "./services/session/gitHistoryOps";
import { gitListHooks, gitRunHook } from "./services/session/gitHooks";
import { gitLfsFiles, gitLfsPull } from "./services/session/gitLfs";
import { gitAm, gitFormatPatch } from "./services/session/gitPatches";
import {
  gitPullV2,
  gitPushV2,
  type PullV2Opts,
  type PushV2Opts,
} from "./services/session/gitPushPull";
import {
  gitRebaseAutosquash,
  gitRebaseInteractivePlan,
  gitRebaseInteractiveRun,
  type RebasePlanEntry,
} from "./services/session/gitRebase";
import { gitReflog } from "./services/session/gitReflog";
import {
  gitAddRemote,
  gitListRemotes,
  gitPruneRemote,
  gitRemoveRemote,
  gitRenameRemote,
  gitSetRemoteUrl,
} from "./services/session/gitRemoteOps";
import {
  gitGetRemotes,
  gitListRecentIssues,
} from "./services/session/gitRemotes";
import {
  gitDiffRange,
  gitFileHistory,
  gitSearchLog,
  type LogSearchCursor,
  type LogSearchFilters,
} from "./services/session/gitSearch";
import { gitStatus } from "./services/session/gitStatus";
import {
  gitSubmoduleDeinit,
  gitSubmoduleInit,
  gitSubmoduleList,
  gitSubmoduleUpdate,
} from "./services/session/gitSubmodules";
import {
  gitCreateTag,
  gitDeleteTag,
  gitListTags,
  gitPushTag,
} from "./services/session/gitTags";
import {
  gitListAssumeUnchangedFiles,
  gitListIgnoredFiles,
} from "./services/session/gitWorkingCopyFilters";
import { gitWorktreeList } from "./services/session/gitWorktrees";
import {
  addRepoRoot,
  removeRepoRoot,
  listSessions,
  createSession,
  createHeadSession,
  deleteSession,
  forkSession,
  forkChatInSession,
  renameSession,
  renameSessionBranch,
  clearSessionSetupError,
  retrySessionSetup,
} from "./services/session/manager";
import { autofillPullRequestBody } from "./services/session/prAutofill";
import { readPullRequestTemplate } from "./services/session/pullRequest";
import {
  getSessionReleaseNotes,
  previewReleaseNotes,
} from "./services/session/releaseNotes";
import {
  getRepoBranch,
  listBranches,
  listAllBranches,
  checkoutBranch,
  getSessionDiff,
  getSessionFullDiff,
  getSessionBranchDiff,
  getSessionStagedDiff,
  getSessionUntrackedDiff,
  getSessionStatus,
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
  watchSession,
  unwatchSession,
  pauseAllWatchers,
  resumeAllWatchers,
  readArgusConfig,
  writeArgusConfig,
  setSessionBaseBranch,
  getSessionCommitsAhead,
  getSessionCommitsBehind,
  getSessionConflicts,
  getSessionMergeBlockers,
  mergeSessionIntoBase,
  rebaseSessionOnBase,
  pushSessionBranch,
  gitPull,
  gitPush,
  gitFetch,
  gitStash,
  gitStashSave,
  gitStashBranch,
  gitStashPop,
  gitLog,
  gitShowCommit,
  gitStashList,
  gitStashShow,
  gitStashApply,
  gitStashDrop,
  gitCheckoutPaths,
} from "./services/session/sessionOps";
import {
  listEditors,
  openInCustomEditor,
  openInEditor,
} from "./services/shell/editors";
import {
  openExternalUrl,
  openPath,
  revealInFinder,
} from "./services/shell/operations";
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
import { getAnonymousId } from "./services/telemetry/anonymousId";
import {
  capture as telemetryCapture,
  captureException as telemetryCaptureException,
  captureFeedback as telemetryCaptureFeedback,
  getTelemetryMode,
  isTelemetryConfigured,
  setTelemetryMode,
} from "./services/telemetry/telemetry";
import {
  createTerminal,
  createRunTerminal,
  listTerminals,
  startTerminal,
  destroyTerminal,
  stopTerminal,
  terminalWrite,
  terminalResize,
  updateTerminalTitle,
} from "./services/terminal/multiplexer";
import {
  getEnabledToolsForRenderer,
  toolEnabled,
  setEnabledToolsFromRenderer,
} from "./services/tools/state";
import { getUiState, setUiState } from "./services/uiState";
import {
  checkForUpdates as updaterCheck,
  downloadUpdate as updaterDownload,
  getUpdaterState,
  quitAndInstallUpdate,
} from "./services/updater";
import {
  archiveBranch as archiveBranchSetting,
  listArchivedBranches as listArchivedBranchesSetting,
  listPinnedBranches as listPinnedBranchesSetting,
  loadUserProjectSettings,
  pinBranch as pinBranchSetting,
  saveUserProjectSettings,
  unarchiveBranch as unarchiveBranchSetting,
  unpinBranch as unpinBranchSetting,
  type UserProjectSettings,
} from "./services/userProjectSettings/store";
import { appState } from "./state";

type Args = Record<string, unknown>;

function emitNavState(sessionId: string, nav: NavState): void {
  getMainWindow()?.webContents.send("browser_view:nav", {
    sessionId,
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

/**
 * Helper: register a tool-gated handler. The body only runs when the
 * specified tool is currently enabled; otherwise the IPC call rejects with
 * "tool disabled". UI surfaces that depend on a tool are filtered upstream
 * via `useEffectiveToolEnabled`, so this is defense-in-depth — it also
 * stops other agents/scripts that hold a renderer handle from poking at
 * disabled features.
 */
function toolHandle(
  channel: string,
  toolId: ToolId,
  handler: (args: Args) => Promise<unknown> | unknown,
): void {
  handle(channel, (args) => {
    if (!toolEnabled(toolId)) {
      throw `tool disabled: ${toolId}`;
    }

    return handler(args);
  });
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
      // GitError needs to survive the IPC boundary as structured data so the
      // renderer can rehydrate kind/recovery. Electron preserves own
      // enumerable properties on thrown Error objects across IPC, so we
      // attach the payload fields as enumerable props on a fresh Error.
      if (err instanceof GitError) {
        const payload = serializeGitError(err);
        const wrapped = new Error(payload.message);
        Object.assign(wrapped, payload);
        throw wrapped;
      }
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
  handle("list_session_files", (a) => listSessionFiles(a.id as string));
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

  // Auto-updater
  handle("updater_get_state", () => getUpdaterState());
  handle("updater_check", (a) => updaterCheck({ silent: a.silent === true }));
  handle("updater_download", () => updaterDownload());
  handle("updater_quit_and_install", () => {
    quitAndInstallUpdate();
  });

  // Session CRUD
  handle("list_interesting_pull_requests", (a) =>
    listInterestingPullRequests((a.repoRoots as string[]) ?? []),
  );

  handle("get_pull_request_detail", (a) =>
    getPullRequestDetail(
      a.owner as string,
      a.repo as string,
      a.number as number,
    ),
  );

  handle("get_pull_request_diff", (a) =>
    getPullRequestDiff(a.owner as string, a.repo as string, a.number as number),
  );

  handle("read_pr_template", (a) =>
    Promise.resolve(readPullRequestTemplate(a.repoRoot as string)),
  );

  handle("autofill_pr_template", (a) =>
    autofillPullRequestBody({
      sessionId: a.sessionId as string,
      title: a.title as string,
      baseBranch: a.baseBranch as string,
    }),
  );

  handle("gh_pr_create", (a) =>
    ghPrCreate({
      repoRoot: a.repoRoot as string,
      title: a.title as string,
      body: a.body as string,
      base: a.base as string,
      head: a.head as string,
      draft: (a.draft as boolean | undefined) ?? false,
    }),
  );

  handle("gh_pr_comment", (a) =>
    ghPrComment({
      owner: a.owner as string,
      repo: a.repo as string,
      number: a.number as number,
      body: a.body as string,
    }),
  );

  handle("gh_pr_merge", (a) =>
    ghPrMerge({
      owner: a.owner as string,
      repo: a.repo as string,
      number: a.number as number,
      strategy: a.strategy as MergeStrategy,
    }),
  );

  handle("gh_pr_close", (a) =>
    ghPrClose({
      owner: a.owner as string,
      repo: a.repo as string,
      number: a.number as number,
    }),
  );

  handle("gh_list_issues", (a) => listGhIssues(a.repoRoot as string));

  handle("add_repo_root", (a) => addRepoRoot(a.path as string));
  handle("remove_repo_root", (a) => removeRepoRoot(a.path as string));
  handle("list_projects", () => collectAllProjects());
  handle("list_sessions", (a) => listSessions(a.repoRoot as string));
  handle("create_session", (a) =>
    createSession(
      a.repoRoot as string,
      a.branch as string,
      a.description as string,
      a.useExistingBranch as boolean | undefined,
      a.baseBranch as string | undefined,
      a.appDefaultLlm as
        | { runner?: string | null; model?: string | null }
        | undefined,
    ),
  );
  handle("create_project_root_session", (a) =>
    createHeadSession(a.repoRoot as string),
  );
  handle("delete_session", (a) =>
    deleteSession(a.id as string, a.shouldDeleteBranch as boolean | undefined),
  );
  handle("rename_session", (a) =>
    renameSession(a.id as string, a.displayName as string),
  );
  handle("rename_session_branch", (a) =>
    renameSessionBranch(a.id as string, a.branch as string),
  );
  handle("clear_session_setup_error", (a) =>
    clearSessionSetupError(a.id as string),
  );
  handle("retry_session_setup", (a) => retrySessionSetup(a.id as string));
  handle("fork_session", (a) =>
    forkSession(
      a.sourceSessionId as string,
      a.branch as string,
      a.description as string,
      a.forkTimestampMs as number,
      a.forkTurnNumber as number,
      a.sourceClaudeSessionId as string | null | undefined,
      a.replayOps as Parameters<typeof forkSession>[6],
    ),
  );
  handle("fork_chat_in_session", (a) =>
    forkChatInSession(
      a.sourceSessionId as string,
      a.sourceClaudeSessionId as string,
      a.forkTimestampMs as number,
      a.forkTurnNumber as number,
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

  // Session ops
  handle("get_repo_branch", (a) => getRepoBranch(a.repoRoot as string));
  handle("list_branches", (a) => listBranches(a.repoRoot as string));
  handle("list_all_branches", (a) => listAllBranches(a.repoRoot as string));
  handle("checkout_branch", (a) =>
    checkoutBranch(a.repoRoot as string, a.branch as string),
  );

  // Phase 6 P2 / P5 — project-root branch listing + ops (session-keyed,
  // gated to project_root sessions on the backend for mutating ops).
  handle("git_list_local_branches", (a) =>
    gitListLocalBranches(a.id as string),
  );
  handle("git_list_remote_branches", (a) =>
    gitListRemoteBranches(a.id as string),
  );
  handle("git_create_branch", (a) =>
    gitCreateBranch(a.id as string, {
      name: a.name as string,
      startPoint: a.startPoint as string | undefined,
      checkout: a.checkout as boolean | undefined,
    }),
  );
  handle("git_delete_branch", (a) =>
    gitDeleteBranch(a.id as string, {
      name: a.name as string,
      force: a.force as boolean | undefined,
    }),
  );
  handle("git_rename_branch", (a) =>
    gitRenameBranch(a.id as string, {
      from: a.from as string,
      to: a.to as string,
    }),
  );
  handle("git_checkout", (a) =>
    gitCheckout(a.id as string, {
      branch: a.branch as string,
      create: a.create as boolean | undefined,
    }),
  );
  handle("git_set_upstream", (a) =>
    gitSetUpstream(a.id as string, {
      branch: a.branch as string,
      upstream: a.upstream as string,
    }),
  );
  handle("git_merge_branch", (a) =>
    gitMergeBranch(a.id as string, {
      from: a.from as string,
      into: a.into as string | undefined,
      squash: a.squash as boolean | undefined,
    }),
  );
  handle("git_stash_and_checkout", (a) =>
    gitStashAndCheckout(a.id as string, { branch: a.branch as string }),
  );
  handle("git_discard_and_checkout", (a) =>
    gitDiscardAndCheckout(a.id as string, { branch: a.branch as string }),
  );
  handle("git_rebase_onto", (a) =>
    gitRebaseOnto(a.id as string, {
      upstream: a.upstream as string,
      branch: a.branch as string | undefined,
    }),
  );
  handle("get_session_diff", (a) => getSessionDiff(a.id as string));
  handle("get_session_full_diff", (a) => getSessionFullDiff(a.id as string));
  handle("get_session_branch_diff", (a) =>
    getSessionBranchDiff(a.id as string, {
      ignoreWhitespace: a.ignoreWhitespace as boolean | undefined,
      wordDiff: a.wordDiff as boolean | undefined,
    }),
  );
  handle("get_session_staged_diff", (a) =>
    getSessionStagedDiff(a.id as string, {
      ignoreWhitespace: a.ignoreWhitespace as boolean | undefined,
      wordDiff: a.wordDiff as boolean | undefined,
    }),
  );
  handle("get_session_untracked_diff", (a) =>
    getSessionUntrackedDiff(a.id as string),
  );
  handle("get_session_status", (a) => getSessionStatus(a.id as string));
  handle("git_status", (a) => gitStatus(a.id as string));
  handle("git_list_ignored_files", (a) => gitListIgnoredFiles(a.id as string));
  handle("git_list_assume_unchanged_files", (a) =>
    gitListAssumeUnchangedFiles(a.id as string),
  );
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
  handle("discard_hunk", (a) =>
    discardHunk(a.id as string, a.patch as string, a.staged as boolean),
  );
  handle("git_commit", (a) =>
    gitCommit(a.id as string, a.message as string, a.amend as boolean),
  );
  handle("get_git_author", (a) => getGitAuthor(a.id as string));
  handle("get_last_commit_message", (a) =>
    getLastCommitMessage(a.id as string),
  );
  handle("get_last_commit_hash", (a) => getLastCommitHash(a.id as string));
  handle("watch_session", (a) => watchSession(a.id as string));
  handle("unwatch_session", (a) => unwatchSession(a.id as string));
  handle("pause_all_watchers", () => pauseAllWatchers());
  handle("resume_all_watchers", () => resumeAllWatchers());
  handle("read_argus_config", (a) => readArgusConfig(a.repoRoot as string));
  handle("write_argus_config", (a) =>
    writeArgusConfig(a.repoRoot as string, a.content as string),
  );
  handle("get_user_project_settings", (a) =>
    loadUserProjectSettings(a.repoRoot as string),
  );
  handle("set_user_project_settings", (a) =>
    saveUserProjectSettings(
      a.repoRoot as string,
      a.settings as UserProjectSettings,
    ),
  );
  handle("git_archive_branch", (a) =>
    archiveBranchSetting(a.repoRoot as string, a.branch as string),
  );
  handle("git_unarchive_branch", (a) =>
    unarchiveBranchSetting(a.repoRoot as string, a.branch as string),
  );
  handle("git_list_archived_branches", (a) =>
    listArchivedBranchesSetting(a.repoRoot as string),
  );
  handle("git_pin_branch", (a) =>
    pinBranchSetting(a.repoRoot as string, a.branch as string),
  );
  handle("git_unpin_branch", (a) =>
    unpinBranchSetting(a.repoRoot as string, a.branch as string),
  );
  handle("git_list_pinned_branches", (a) =>
    listPinnedBranchesSetting(a.repoRoot as string),
  );
  handle("get_app_settings", () => loadAppSettings());
  handle("set_app_settings", (a) => saveAppSettings(a.settings as AppSettings));
  handle("list_inherited_mcp_servers", (a) =>
    listInheritedMcpServers((a.worktreePath as string | null) ?? null),
  );
  handle("test_mcp_server", (a) =>
    testMcpServer(a.config as Record<string, unknown>),
  );
  handle("mcp_oauth_sign_in", (a) =>
    authenticate({
      serverUrl: a.serverUrl as string,
      resourceMetadataUrl: (a.resourceMetadataUrl as string | null) ?? null,
    }).then((t) => ({
      resource: t.resource,
      hasRefreshToken: Boolean(t.refreshToken),
      expiresAt: t.expiresAt ?? null,
      scope: t.scope ?? null,
    })),
  );
  handle("mcp_oauth_sign_out", (a) => signOut(a.serverUrl as string));
  handle("mcp_oauth_cancel_sign_in", (a) =>
    Promise.resolve(cancelAuthentication(a.serverUrl as string)),
  );
  handle("mcp_oauth_status", async (a) => {
    const t = await loadToken(a.serverUrl as string);
    if (!t) {
      return null;
    }

    return {
      resource: t.resource,
      hasRefreshToken: Boolean(t.refreshToken),
      expiresAt: t.expiresAt ?? null,
      scope: t.scope ?? null,
    };
  });
  handle("mcp_oauth_list_authorized", () => listAuthorized());
  handle("get_command_metrics", (a) =>
    loadCommandMetrics(a.repoRoot as string),
  );
  handle("set_session_base_branch", (a) =>
    setSessionBaseBranch(a.id as string, a.baseBranch as string),
  );
  handle("get_session_conflicts", (a) => getSessionConflicts(a.id as string));
  handle("get_session_merge_blockers", (a) =>
    getSessionMergeBlockers(a.id as string),
  );
  handle("get_session_release_notes", (a) =>
    getSessionReleaseNotes(a.id as string),
  );
  handle("preview_release_notes", (a) =>
    previewReleaseNotes(
      a.repoRoot as string,
      a.patterns as Parameters<typeof previewReleaseNotes>[1],
    ),
  );
  handle("get_session_commits_ahead", (a) =>
    getSessionCommitsAhead(a.id as string),
  );
  handle("merge_session_into_base", (a) =>
    mergeSessionIntoBase(a.id as string),
  );
  handle("get_session_commits_behind", (a) =>
    getSessionCommitsBehind(a.id as string),
  );
  handle("rebase_session_on_base", (a) => rebaseSessionOnBase(a.id as string));
  handle("push_session_branch", (a) => pushSessionBranch(a.id as string));
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
  handle("git_stash_save", (a) =>
    gitStashSave(a.id as string, {
      message: a.message as string | undefined,
      includeUntracked: a.includeUntracked as boolean | undefined,
      keepIndex: a.keepIndex as boolean | undefined,
      paths: a.paths as string[] | undefined,
    }),
  );
  handle("git_stash_branch", (a) =>
    gitStashBranch(
      a.id as string,
      a.stashRef as string,
      a.branchName as string,
    ),
  );
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
  handle("git_checkout_paths", (a) =>
    gitCheckoutPaths(a.id as string, a.ref as string, a.paths as string[]),
  );

  // Phase 2 W5 — discard / untrack / .gitignore
  handle("git_discard_file", (a) =>
    gitDiscardFile(a.id as string, a.filePath as string),
  );
  handle("git_discard_hunk", (a) =>
    gitDiscardHunk(a.id as string, a.hunkPatch as string),
  );
  handle("git_discard_lines", (a) =>
    gitDiscardLines(
      a.id as string,
      a.filePath as string,
      (a.lines as number[]) ?? [],
      (a.side as "new" | "old") ?? "new",
      a.hunkPatch as string,
    ),
  );
  handle("git_untrack_file", (a) =>
    gitUntrackFile(a.id as string, a.filePath as string),
  );
  handle("add_to_gitignore", (a) =>
    addToGitignore(a.id as string, a.filePath as string),
  );

  // Phase 2 W9 — conflict resolution
  handle("git_continue_merge", (a) => gitContinueMerge(a.id as string));
  handle("git_abort_merge", (a) => gitAbortMerge(a.id as string));
  handle("git_continue_rebase", (a) => gitContinueRebase(a.id as string));
  handle("git_abort_rebase", (a) => gitAbortRebase(a.id as string));
  handle("git_skip_rebase", (a) => gitSkipRebase(a.id as string));
  handle("git_continue_cherry_pick", (a) =>
    gitContinueCherryPick(a.id as string),
  );
  handle("git_abort_cherry_pick", (a) => gitAbortCherryPick(a.id as string));
  handle("git_get_conflict", (a) =>
    gitGetConflict(a.id as string, a.filePath as string),
  );
  handle("git_mark_resolved", (a) =>
    gitMarkResolved(a.id as string, a.filePath as string),
  );
  handle("git_write_conflict_merged", (a) =>
    gitWriteConflictMerged(
      a.id as string,
      a.filePath as string,
      a.contents as string,
    ),
  );

  // Phase 2 W10 — git config get/set (per-repo)
  handle("git_get_config", (a) =>
    gitGetConfig(a.id as string, a.key as string),
  );
  handle("git_set_config", (a) =>
    gitSetConfig(a.id as string, a.key as string, a.value as string),
  );

  // Phase 2 W10 — remotes + issue autocomplete scaffold
  handle("git_get_remotes", (a) => gitGetRemotes(a.id as string));
  handle("git_list_recent_issues", (a) =>
    gitListRecentIssues(a.id as string, (a.query as string | undefined) ?? ""),
  );

  handle("git_amend_tip", (a) =>
    gitAmendTip(a.id as string, a.subject as string, a.body as string),
  );

  // Phase 4 H1 / H4 / H8 / H7 / H9 — history depth
  handle("git_search_log", (a) =>
    gitSearchLog(a.id as string, {
      query: a.query as string | undefined,
      author: a.author as string | undefined,
      since: a.since as string | undefined,
      until: a.until as string | undefined,
      branch: a.branch as string | undefined,
      paths: a.paths as string[] | undefined,
      refType: a.refType as LogSearchFilters["refType"],
      regex: a.regex as boolean | undefined,
      cursor: (a.cursor as LogSearchCursor | null) ?? null,
      limit: a.limit as number | undefined,
    }),
  );
  handle("git_diff_range", (a) =>
    gitDiffRange(a.id as string, a.fromRef as string, a.toRef as string),
  );
  handle("git_file_history", (a) =>
    gitFileHistory(a.id as string, a.path as string),
  );
  handle("git_blame_file", (a) =>
    gitBlameFile(
      a.id as string,
      a.path as string,
      (a.ref as string | undefined) ?? undefined,
    ),
  );
  // Phase 7 image-diff — read binary blob as base64
  handle("git_read_blob_at_ref", (a) =>
    gitReadBlobAtRef(a.id as string, a.path as string, a.ref as string),
  );
  handle("git_reflog", (a) =>
    gitReflog(a.id as string, {
      limit: a.limit as number | undefined,
      ref: a.ref as string | undefined,
    }),
  );

  // Phase 6B P7 — tags
  handle("git_list_tags", (a) => gitListTags(a.id as string));
  handle("git_create_tag", (a) =>
    gitCreateTag(a.id as string, {
      name: a.name as string,
      ref: a.ref as string | undefined,
      message: a.message as string | undefined,
      sign: a.sign as boolean | undefined,
      force: a.force as boolean | undefined,
    }),
  );
  handle("git_delete_tag", (a) =>
    gitDeleteTag(a.id as string, { name: a.name as string }),
  );
  handle("git_push_tag", (a) =>
    gitPushTag(a.id as string, {
      name: a.name as string | undefined,
      all: a.all as boolean | undefined,
      remote: a.remote as string | undefined,
    }),
  );

  // Phase 6B P8 — remotes (rich)
  handle("git_list_remotes", (a) => gitListRemotes(a.id as string));
  handle("git_add_remote", (a) =>
    gitAddRemote(a.id as string, {
      name: a.name as string,
      url: a.url as string,
    }),
  );
  handle("git_remove_remote", (a) =>
    gitRemoveRemote(a.id as string, { name: a.name as string }),
  );
  handle("git_rename_remote", (a) =>
    gitRenameRemote(a.id as string, {
      from: a.from as string,
      to: a.to as string,
    }),
  );
  handle("git_set_remote_url", (a) =>
    gitSetRemoteUrl(a.id as string, {
      name: a.name as string,
      url: a.url as string,
      push: a.push as boolean | undefined,
    }),
  );
  handle("git_prune_remote", (a) =>
    gitPruneRemote(a.id as string, { name: a.name as string }),
  );

  // Phase 6B P11 — push/pull v2
  handle("git_push_v2", (a) =>
    gitPushV2(a.id as string, {
      remote: a.remote as string | undefined,
      branch: a.branch as string | undefined,
      force: a.force as boolean | undefined,
      forceWithLease: a.forceWithLease as boolean | undefined,
      setUpstream: a.setUpstream as boolean | undefined,
      tags: a.tags as PushV2Opts["tags"],
      ref: a.ref as string | undefined,
    }),
  );
  handle("git_pull_v2", (a) =>
    gitPullV2(a.id as string, {
      strategy: a.strategy as PullV2Opts["strategy"],
      prune: a.prune as boolean | undefined,
      tags: a.tags as boolean | undefined,
      remote: a.remote as string | undefined,
      branch: a.branch as string | undefined,
    }),
  );

  // Phase 6B P12 — reset / revert / cherry-pick
  handle("git_reset", (a) =>
    gitReset(a.id as string, {
      ref: a.ref as string,
      mode: a.mode as "hard" | "mixed" | "soft",
    }),
  );
  handle("git_revert", (a) =>
    gitRevert(a.id as string, {
      hash: a.hash as string,
      noCommit: a.noCommit as boolean | undefined,
    }),
  );
  handle("git_cherry_pick", (a) =>
    gitCherryPick(a.id as string, {
      hash: a.hash as string[] | string,
      noCommit: a.noCommit as boolean | undefined,
    }),
  );

  // Phase 6B P9 — submodules
  handle("git_submodule_list", (a) => gitSubmoduleList(a.id as string));
  handle("git_submodule_init", (a) =>
    gitSubmoduleInit(a.id as string, {
      path: a.path as string | undefined,
    }),
  );
  handle("git_submodule_update", (a) =>
    gitSubmoduleUpdate(a.id as string, {
      path: a.path as string | undefined,
      remote: a.remote as boolean | undefined,
    }),
  );
  handle("git_submodule_deinit", (a) =>
    gitSubmoduleDeinit(a.id as string, {
      path: a.path as string,
      force: a.force as boolean | undefined,
    }),
  );

  // Phase 6B P10 — worktrees
  handle("git_worktree_list", (a) => gitWorktreeList(a.id as string));

  // Phase 7 T1/T2 — interactive rebase
  handle("git_rebase_interactive_plan", (a) =>
    gitRebaseInteractivePlan(a.id as string, {
      upstream: a.upstream as string,
    }),
  );
  handle("git_rebase_interactive_run", (a) =>
    gitRebaseInteractiveRun(a.id as string, {
      upstream: a.upstream as string,
      plan: a.plan as RebasePlanEntry[],
    }),
  );
  handle("git_rebase_autosquash", (a) =>
    gitRebaseAutosquash(a.id as string, {
      upstream: a.upstream as string,
    }),
  );

  // Phase 7 T3 — bisect
  handle("git_bisect_start", (a) =>
    gitBisectStart(a.id as string, {
      goodRef: a.goodRef as string,
      badRef: a.badRef as string,
    }),
  );
  handle("git_bisect_good", (a) => gitBisectGood(a.id as string));
  handle("git_bisect_bad", (a) => gitBisectBad(a.id as string));
  handle("git_bisect_skip", (a) => gitBisectSkip(a.id as string));
  handle("git_bisect_reset", (a) => gitBisectReset(a.id as string));
  handle("git_bisect_status", (a) => gitBisectStatus(a.id as string));

  // Phase 7 T5 — credential helpers
  handle("check_ssh_keys", () => checkSshKeys());
  handle("get_global_credential_helper", () => getGlobalCredentialHelper());
  handle("set_global_credential_helper", (a) =>
    setGlobalCredentialHelper(a.name as "osxkeychain" | "store"),
  );

  // Phase 7 T6 — git LFS
  handle("git_lfs_files", (a) => gitLfsFiles(a.id as string));
  handle("git_lfs_pull", (a) =>
    gitLfsPull(a.id as string, {
      paths: a.paths as string[] | undefined,
    }),
  );

  // Phase 7 T7 — patches
  handle("git_format_patch", (a) =>
    gitFormatPatch(a.id as string, {
      range: a.range as string,
      outputDir: a.outputDir as string | undefined,
    }),
  );
  handle("git_am", (a) =>
    gitAm(a.id as string, { patchPaths: a.patchPaths as string[] }),
  );

  // Phase 7 T8 — hooks
  handle("git_list_hooks", (a) => gitListHooks(a.id as string));
  handle("git_run_hook", (a) =>
    gitRunHook(a.id as string, { name: a.name as string }),
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
  handle("start_agent", async (a) => {
    const info = await startAgent(
      a.sessionId as string,
      a.model as string | undefined,
      a.permissionMode as string | undefined,
      a.resumeSessionId as string | undefined,
      a.appendSystemPrompt as string | undefined,
      undefined,
      undefined,
      undefined, // reuseAgentId — IPC callers are always fresh starts
      a.agentId as string | undefined, // presetAgentId — renderer-minted optimistic id
    );
    // Broadcast so other renderers (e.g. the main window when the agent is
    // started from the global launcher) can register it in their agent
    // store. The initiating renderer's optimistic-start path already added
    // the agent before this fires; its listener dedupes by id.
    broadcastToRenderers("agent:started", info);

    return info;
  });
  handle("stop_agent", (a) => stopAgent(a.agentId as string));
  handle("restore_agent_at_turn", (a) =>
    restoreAgentAtTurn({
      agentId: a.agentId as string,
      sourceClaudeSessionId: a.sourceClaudeSessionId as string,
      keepTurnNumber: a.keepTurnNumber as number,
      cutoffTimestampMs: a.cutoffTimestampMs as number,
    }),
  );
  handle("interrupt_agent", (a) => interruptAgent(a.agentId as string));
  handle("send_agent_message", (a) =>
    sendAgentMessage(
      a.agentId as string,
      a.message as string,
      a.images as { data: string; media_type: string }[] | undefined,
    ),
  );
  handle("list_agents", (a) => listAgents(a.sessionId as string));
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
  handle("set_agent_effort", (a) =>
    setAgentEffort(a.agentId as string, (a.level as string | null) ?? null),
  );
  handle("prewarm_agent", (a) => prewarmAgent(a.sessionId as string));
  handle("claim_prewarm_agent", (a) =>
    claimPrewarmAgent(a.agentId as string, {
      model: a.model as string | undefined,
      permissionMode: a.permissionMode as string | undefined,
    }),
  );
  handle("discard_prewarm_agent", (a) =>
    discardPrewarmAgent(a.agentId as string),
  );

  // Checkpoint commands — snapshot the worktree before each user prompt so
  // it can later be restored from a chat message.
  handle("create_checkpoint", (a) => createCheckpoint(a.sessionId as string));
  handle("restore_checkpoint", (a) =>
    restoreCheckpoint(a.sessionId as string, a.checkpointId as string),
  );
  handle("delete_checkpoint", (a) =>
    deleteCheckpoint(a.sessionId as string, a.checkpointId as string),
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
    generateChatTitle(a.firstMessage as string),
  );

  // Terminal commands.
  //
  // `create_terminal` deliberately does NOT accept a free-form `command`
  // parameter. Allowing the renderer (or any caller transitively reaching this
  // IPC) to inject an arbitrary `sh -c <command>` would turn any renderer
  // compromise (XSS via agent/file/MCP-controlled markdown) into full RCE.
  // Callers that need to start the session's configured run command must
  // use `create_run_terminal`, which resolves the command server-side from
  // `.argus.json`.
  handle("create_terminal", (a) =>
    createTerminal(
      a.sessionId as string,
      a.subDir as string | undefined,
      undefined,
      a.title as string | undefined,
    ),
  );
  handle("create_run_terminal", (a) =>
    createRunTerminal(a.sessionId as string, a.title as string | undefined),
  );
  handle("list_terminals", (a) => listTerminals(a.sessionId as string));
  handle("update_terminal_title", (a) =>
    updateTerminalTitle(a.terminalId as string, a.title as string),
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

  // Simulator commands. The picker (`list_simulators`) and Xcode probe stay
  // ungated — they're cheap, and the renderer uses them to show "Install
  // Xcode" hints regardless of tool state. Capture and HID input are gated.
  handle("check_ios_tools", () => checkIosTools());
  handle("list_simulators", () => listSimulators());
  handle("boot_simulator", (a) => bootSimulator(a.udid as string));
  handle("disconnect_simulator", (a) => disconnectSimulator(a.udid as string));
  handle("active_simulator", () => activeSimulator());
  toolHandle("start_simulator_capture", "device-recording", (a) =>
    startSimulatorCapture(a.udid as string),
  );
  toolHandle("stop_simulator_capture", "device-recording", (a) =>
    Promise.resolve(stopSimulatorCapture(a.udid as string)),
  );
  toolHandle("simulator_touch", "device-control", (a) =>
    simulatorTouch(
      a.udid as string,
      a.x as number,
      a.y as number,
      a.eventType as number,
    ),
  );
  toolHandle("simulator_button", "device-control", (a) =>
    simulatorButton(a.udid as string, a.button as string),
  );
  toolHandle("device_open_link", "device-control", (a) =>
    openDeepLink(a.deviceKey as string, a.url as string),
  );
  toolHandle("simulator_keyboard", "device-control", (a) =>
    simulatorKeyboard(
      a.udid as string,
      a.keyCode as number,
      a.modifierFlags as number,
      a.isDown as boolean,
    ),
  );
  toolHandle("open_simulator_popout", "device-recording", async (a) => {
    const udid = a.udid as string;
    const existing = appState.simulatorPopouts.get(udid);
    if (existing && !existing.isDestroyed()) {
      existing.show();
      existing.focus();

      return;
    }

    const devices = await listSimulators().catch(() => []);
    const device = devices.find((d) => d.udid === udid);
    const active = appState.simulators.get(udid);
    const deviceName = active?.deviceName ?? device?.name ?? "Simulator";
    const booted = device?.booted ?? false;

    // Only acquire a capture reference when the device is actually booted.
    // Starting capture on a shutdown simulator can return a misleading port
    // that makes the popout think it's streaming and hides the Boot button —
    // leaving the user with an empty frame and no way to boot. For shutdown
    // devices, open the popout in placeholder mode; its own Boot flow will
    // start capture once the user boots.
    let mjpegPort: number | null = null;
    if (booted) {
      try {
        mjpegPort = await startSimulatorCapture(udid);
      } catch {
        // Fall back to no stream — popout will show the placeholder.
      }
    }

    createFloatingSimulatorWindow({
      udid,
      mjpegPort,
      deviceName,
      runtime: device?.runtime ?? "",
      booted,
    });
  });
  toolHandle("close_simulator_popout", "device-recording", (a) => {
    closeFloatingSimulatorWindow(a.udid as string);

    return Promise.resolve();
  });

  handle("open_agent_popout", (a) => {
    const agentId = a.agentId as string;
    const sessionId = a.sessionId as string;
    const title = typeof a.title === "string" ? (a.title as string) : undefined;
    const cursorX =
      typeof a.cursorX === "number" ? (a.cursorX as number) : undefined;
    const cursorY =
      typeof a.cursorY === "number" ? (a.cursorY as number) : undefined;
    createFloatingAgentWindow({
      agentId,
      sessionId,
      title,
      cursorX,
      cursorY,
    });
    // Broadcast so every window (including the one that requested it) can
    // hide the agent from its tab bar in sync.
    broadcastToRenderers("agent:popout-opened", { agentId, sessionId });

    return Promise.resolve();
  });
  handle("close_agent_popout", (a) => {
    const agentId = a.agentId as string;
    closeFloatingAgentWindow(agentId);
    // The window's `closed` handler broadcasts `agent:popout-closed`; nothing
    // more to do here.

    return Promise.resolve();
  });
  handle("list_popped_out_agents", () =>
    Promise.resolve(Array.from(appState.agentPopouts.keys())),
  );

  handle("launcher_show", () => {
    showLauncher();

    return Promise.resolve();
  });
  handle("launcher_hide", () => {
    hideLauncher();

    return Promise.resolve();
  });
  handle("launcher_toggle", () => {
    toggleLauncher();

    return Promise.resolve();
  });
  handle("launcher_ready", () => {
    markLauncherRendererReady();

    return Promise.resolve();
  });
  handle("launcher_status", () => Promise.resolve(launcherStatus()));
  handle("launcher_set_enabled", (a) =>
    Promise.resolve(setLauncherEnabled(a.enabled === true)),
  );
  handle("launcher_get_enabled", () => Promise.resolve(isLauncherEnabled()));
  handle("launcher_set_accelerator", (a) =>
    Promise.resolve(updateLauncherAccelerator(String(a.accelerator ?? ""))),
  );
  registerAreaCaptureHandlers();
  handle("focus_main_window", () => {
    const win = getMainWindow();
    if (win && !win.isDestroyed()) {
      win.show();
      win.focus();
    }

    return Promise.resolve();
  });
  handle("navigate_main_window", (a) => {
    const win = getMainWindow();
    if (win && !win.isDestroyed()) {
      win.show();
      win.focus();
      win.webContents.send("navigation:goto", {
        path: a.path as string,
        agentId:
          typeof a.agentId === "string" ? (a.agentId as string) : undefined,
      });
    }

    return Promise.resolve();
  });
  handle("set_pending_session_prompt", (a) => {
    // Broadcast to all renderers — the main window listens via
    // `app/lib/pendingSessionPrompts.ts` and applies the prompt to its
    // local sessionStore so the agent boots once the session reaches `ready`.
    broadcastToRenderers("session:pending-prompt", {
      sessionId: a.sessionId as string,
      prompt: (a.prompt as string) ?? "",
      images: a.images,
      model: a.model,
      linkedProjects: a.linkedProjects,
    });

    return Promise.resolve();
  });
  handle("publish_agent_snapshot", (a) => {
    const agentId = a.agentId as string;
    const snapshot = a.snapshot as string;
    if (!agentId) {
      return Promise.resolve();
    }
    if (typeof snapshot !== "string" || snapshot.length === 0) {
      appState.agentSnapshots.delete(agentId);
    } else {
      appState.agentSnapshots.set(agentId, snapshot);
    }

    return Promise.resolve();
  });
  handle("get_agent_snapshot", (a) => {
    const agentId = a.agentId as string;

    return Promise.resolve(appState.agentSnapshots.get(agentId) ?? null);
  });
  handle("get_session", (a) => {
    const id = a.id as string;

    return Promise.resolve(appState.sessions.get(id) ?? null);
  });

  // Android device commands
  handle("check_android_tools", () => checkAndroidTools());
  handle("list_android_devices", () => listAndroidDevices());
  handle("list_avds", () => listAvds());
  handle("boot_android_emulator", (a) =>
    bootAndroidEmulator(a.avdName as string),
  );
  toolHandle("start_android_capture", "device-recording", (a) =>
    startAndroidCapture(a.serial as string),
  );
  toolHandle("stop_android_capture", "device-recording", () =>
    stopAndroidCapture(),
  );
  toolHandle("disconnect_android_device", "device-recording", (a) =>
    disconnectAndroidDevice(a.serial as string),
  );
  toolHandle("android_touch", "device-control", (a) =>
    androidTouch(
      a.serial as string,
      a.x as number,
      a.y as number,
      a.eventType as number,
    ),
  );
  toolHandle("android_keyboard", "device-control", (a) =>
    androidKeyboard(
      a.keyCode as number,
      a.metaState as number,
      a.isDown as boolean,
    ),
  );
  toolHandle("android_button", "device-control", (a) =>
    androidButton(a.button as string),
  );

  // Browser — Conductor-backed Chromium per session. Pool manages daemons;
  // screencast via raw CDP WebSocket; input forwarded through Conductor HTTP.
  handle("browser_view_ensure", async (a) => {
    const sessionId = a.sessionId as string;
    let reservation = webBrowserPool.getReservation(sessionId);
    if (!reservation) {
      reservation = await webBrowserPool.acquireBrowser(sessionId);
    }
    appState.browserSessions.set(sessionId, {
      id: sessionId,
      url: "",
      webContentsId: null,
    });
    await startScreencast(
      sessionId,
      reservation.cdpPort,
      reservation.cdpTargetId,
      {
        maxWidth: 1440,
        maxHeight: 900,
      },
    );
    getMainWindow()?.webContents.send("browser:ensure_mounted", {
      sessionId,
    });
  });
  handle("browser_view_navigate", async (a) => {
    const sessionId = a.sessionId as string;
    const reservation = webBrowserPool.getReservation(sessionId);
    if (!reservation) {
      return;
    }
    const nav = await conductorNavigate(reservation, a.url as string);
    emitNavState(sessionId, nav);
  });
  handle("browser_view_back", async (a) => {
    const sessionId = a.sessionId as string;
    const reservation = webBrowserPool.getReservation(sessionId);
    if (!reservation) {
      return;
    }
    const nav = await conductorGoBack(reservation);
    emitNavState(sessionId, nav);
  });
  handle("browser_view_forward", async (a) => {
    const sessionId = a.sessionId as string;
    const reservation = webBrowserPool.getReservation(sessionId);
    if (!reservation) {
      return;
    }
    const nav = await conductorGoForward(reservation);
    emitNavState(sessionId, nav);
  });
  handle("browser_view_reload", async (a) => {
    const sessionId = a.sessionId as string;
    const reservation = webBrowserPool.getReservation(sessionId);
    if (!reservation) {
      return;
    }
    const nav = await conductorReload(reservation);
    emitNavState(sessionId, nav);
  });
  handle("browser_view_destroy", async (a) => {
    const sessionId = a.sessionId as string;
    await stopScreencast(sessionId);
    appState.browserSessions.delete(sessionId);
    await webBrowserPool.releaseBrowser(sessionId);
  });
  toolHandle("browser_mouse_event", "device-control", async (a) => {
    const reservation = webBrowserPool.getReservation(a.sessionId as string);
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
  toolHandle("browser_keyboard_event", "device-control", async (a) => {
    const reservation = webBrowserPool.getReservation(a.sessionId as string);
    if (reservation) {
      await conductorKeyboardEvent(
        reservation,
        a.type as "down" | "press" | "up",
        a.key as string,
      );
    }
  });
  toolHandle("browser_wheel_event", "device-control", async (a) => {
    const reservation = webBrowserPool.getReservation(a.sessionId as string);
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
    const sessionId = a.sessionId as string;
    const preset = a.preset as BrowserPreset;
    const reservation = webBrowserPool.getReservation(sessionId);
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
      await restartScreencast(sessionId, reservation.cdpPort, newTargetId, {
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
  toolHandle("list_conductor_logs", "device-control", (a) =>
    conductorLogStore.list(a.deviceKey as string),
  );
  toolHandle("inspection_capture", "device-inspector", (a) =>
    captureUi({ deviceKey: a.deviceKey as string }),
  );
  toolHandle("run_conductor_command", "device-control", async (a) => {
    const deviceKey = a.deviceKey as string;
    const args = a.args as string[];
    const hasDeviceFlag = args.some((x) => x === "--device" || x === "-d");
    const finalArgs = hasDeviceFlag ? args : [...args, "--device", deviceKey];
    await execConductor(deviceKey, finalArgs);
  });

  // Debug panel — streaming conductor subprocesses + one-shot probes.
  toolHandle("debug_start_stream", "device-debug", (a) => {
    startDebugStream({
      streamId: a.streamId as string,
      deviceKey: a.deviceKey as string,
      args: a.args as string[],
    });

    return null;
  });
  toolHandle("debug_stop_stream", "device-debug", (a) => {
    stopDebugStream(a.streamId as string);

    return null;
  });
  toolHandle("debug_list_streams", "device-debug", () => listDebugStreams());
  toolHandle("debug_run_command", "device-debug", (a) =>
    runDebugCommand(a.deviceKey as string, a.args as string[]),
  );

  // Shell
  handle("reveal_in_finder", (a) => revealInFinder(a.path as string));
  handle("open_path", (a) => openPath(a.path as string));
  handle("open_external_url", (a) => openExternalUrl(a.url as string));
  handle("list_editors", () => listEditors());
  handle("open_in_editor", (a) =>
    openInEditor(a.editorId as string, a.path as string),
  );
  handle("open_in_custom_editor", (a) =>
    openInCustomEditor(a.command as string, a.path as string),
  );

  // Extensions
  handle("discover_extensions", () => discoverExtensions());

  // Tools — backend mirror of the renderer's enable map.
  handle("get_enabled_tools", () => getEnabledToolsForRenderer());
  handle("set_enabled_tools", (a) => {
    setEnabledToolsFromRenderer(
      (a.userEnabled ?? {}) as Partial<Record<string, boolean>>,
    );
  });
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
  handle("show_open_dialog", async (a) => {
    const win = getMainWindow();
    if (!win) {
      return null;
    }
    const title = (a?.title as string | undefined) ?? "Select Repository Root";
    const result = await dialog.showOpenDialog(win, {
      properties: ["openDirectory"],
      title,
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
    runPrereqFixer(
      a.id as PrereqId,
      {
        gitName: a.gitName as string | undefined,
        gitEmail: a.gitEmail as string | undefined,
      },
      (update: PrereqResult) => {
        getMainWindow()?.webContents.send("onboarding:prereq_update", update);
      },
    ),
  );
  handle("onboarding_claude_ping", () => onboardingClaudePing());
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
  handle("onboarding_refine_argus_json_with_claude", (a) =>
    refineArgusJsonWithClaude(
      a.path as string,
      a.config as Record<string, unknown>,
    ),
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

  // LLM runner registry — surfaced to the renderer so onboarding can render
  // each registered runner's contributed steps without hard-coding runner ids.
  handle("llm_list_onboarding_steps", () => listRunnerOnboardingSteps());
  handle("llm_list_runners", () =>
    listLlmRunners().map((r) => ({
      id: r.id,
      displayName: r.displayName,
      capabilities: r.capabilities(),
    })),
  );

  // Telemetry — anonymous PostHog. Renderer asks for the install id + current
  // enable state at boot, and pushes opt-in/opt-out toggles back here.
  handle("get_app_version", () => app.getVersion());
  handle("telemetry_get_init", () => ({
    distinctId: getAnonymousId(),
    mode: getTelemetryMode(),
    configured: isTelemetryConfigured(),
    appVersion: app.getVersion(),
  }));
  handle("telemetry_set_mode", (a) => {
    const next = a.mode;
    if (next === "off" || next === "presence" || next === "full") {
      setTelemetryMode(next);
    }
  });
  handle("telemetry_capture", (a) => {
    // The renderer is responsible for matching the event catalog (typed on
    // its side via app/lib/telemetryEvents.ts). At the IPC boundary it
    // arrives as opaque strings; we trust the renderer's type-checked call
    // sites and forward as-is.
    telemetryCapture(
      String(a.event) as Parameters<typeof telemetryCapture>[0],
      (a.props ?? {}) as never,
    );
  });
  handle("telemetry_capture_exception", (a) => {
    const message = String(a.message ?? "renderer error");
    const stack = typeof a.stack === "string" ? a.stack : undefined;
    const err = new Error(message);
    if (stack) {
      err.stack = stack;
    }
    telemetryCaptureException(err, (a.props as Record<string, unknown>) ?? {});
  });
  handle("telemetry_capture_feedback", (a) => {
    telemetryCaptureFeedback(String(a.message ?? ""));
  });

  // Phase 10 — auto-fetch reconfiguration. Called by the UI after the user
  // changes `auto_fetch_minutes` in `.argus.json` via Project Settings.
  handle("git_reconfigure_auto_fetch", (a) => {
    const repoRoot = a.repoRoot as string;
    const minutes = a.minutes as number | null;
    let protectedBranches: string[] = [];
    try {
      protectedBranches = readArgusConfig(repoRoot).protected_branches ?? [];
    } catch {
      // Config unreadable — fall back to no protected branches.
    }
    reconfigureAutoFetchForRepo(repoRoot, minutes, protectedBranches);
  });

  // Phase 5 — compare-branches view.
  handle("git_compare_branches", (a) =>
    gitCompareBranches(a.sessionId as string, {
      left: a.left as string,
      right: a.right as string,
    }),
  );
}
