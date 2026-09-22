/**
 * IPC command registration — routes commands to service functions.
 *
 * Every command is declared through `defineCommand` (via the local `handle`
 * helpers), which owns the registry entry; `ipcBridge.ts` publishes it on IPC.
 * Each handler unwraps the args object and delegates to the appropriate service.
 * Errors thrown in handlers automatically reject the renderer's promise
 * (errors are thrown as plain strings).
 */

import type { AgentInfo } from "@argus/host/services/agent/models";
import type {
  CreateAutomationInput,
  StartScratchRunInput,
  UpdateAutomationInput,
} from "@argus/host/services/automation/models";
import type { ProposalStatus } from "@argus/host/services/automation/proposals/models";
import type { CommandTier } from "@argus/host/services/command/registry";
import type {
  OnboardingStep,
  PrereqId,
  PrereqResult,
} from "@argus/host/services/onboarding/types";
import type { Session } from "@argus/host/services/session/models";
import type {
  DeviceOrientation,
  FoldPose,
} from "@argus/host/services/simulator/deviceState";
import type { ToolId } from "@argus/host/services/tools/types";
import {
  Menu,
  app,
  clipboard,
  dialog,
  nativeImage,
  systemPreferences,
} from "electron";
import { promises as fs } from "node:fs";
import path from "node:path";
import { emitHostEvent } from "@argus/host/bus";
import {
  saveConversation,
  loadHistoryIndex,
  loadConversation,
  deleteHistoryEntry,
  searchChatHistory,
} from "@argus/host/services/agent/chatHistory";
import {
  createCheckpoint,
  deleteCheckpoint,
  restoreCheckpoint,
} from "@argus/host/services/agent/checkpoints";
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
} from "@argus/host/services/agent/claude";
import {
  clearQueue,
  dequeueMessage,
  enqueueMessage,
  listQueue,
  removeQueuedMessage,
  updateQueuedMessage,
  type QueuedImage,
} from "@argus/host/services/agent/messageQueue";
import {
  loadAppSettings,
  saveAppSettings,
  type AppSettings,
} from "@argus/host/services/appSettings/store";
import { draftAutomation } from "@argus/host/services/automation/authoring";
import {
  clearGateLog,
  dismissGateLogEntry,
  listGateLog,
} from "@argus/host/services/automation/gateLog";
import {
  createAutomation,
  deleteAutomation,
  getAutomationRun,
  listAutomationRuns,
  listAutomations,
  listScratchRuns,
  deleteRun,
  markRunReportRead,
  setAutomationEnabled,
  updateAutomation,
} from "@argus/host/services/automation/manager";
import { calibrationFor } from "@argus/host/services/automation/outcomes";
import { acceptProposal } from "@argus/host/services/automation/proposals/accept";
import { performProposalCleanup } from "@argus/host/services/automation/proposals/cleanup";
import {
  dismissProposal,
  getProposal,
  listProposals,
} from "@argus/host/services/automation/proposals/manager";
import { requestProposalRevision } from "@argus/host/services/automation/proposals/revise";
import {
  cancelAutomationRun,
  startAutomationRun,
} from "@argus/host/services/automation/runner";
import {
  saveScratchRunAsAutomation,
  startScratchRun,
} from "@argus/host/services/automation/scratch";
import {
  startScreencast,
  stopScreencast,
  restartScreencast,
} from "@argus/host/services/browser/cdpScreencast";
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
} from "@argus/host/services/browser/conductorInput";
import { getMjpegPort } from "@argus/host/services/browser/mjpegServer";
import { webBrowserPool } from "@argus/host/services/browser/pool";
import {
  getActiveAccountId,
  listClaudeAccounts,
  removeClaudeAccount,
  renameClaudeAccount,
  setActiveAccount,
} from "@argus/host/services/claudeAuth/accounts";
import {
  claudeAddAccount,
  claudeLoginCancel,
  claudeLoginStart,
  claudeLoginSubmitCode,
  claudeLogout,
  claudeRefreshAccount,
  emitAccountsChanged,
  getClaudeAuthStatus,
} from "@argus/host/services/claudeAuth/claudeAuth";
import { defineCommand } from "@argus/host/services/command/registry";
import {
  listDebugStreams,
  runDebugCommand,
  startDebugStream,
  stopDebugStream,
} from "@argus/host/services/conductor/debug";
import {
  listDevices,
  stopDevice,
  type DevicePlatform,
} from "@argus/host/services/conductor/devices";
import {
  conductorLogStore,
  execConductor,
} from "@argus/host/services/conductor/logger";
import { openDeepLink } from "@argus/host/services/conductor/openLink";
import {
  getConductorStatus,
  readBundledVersion,
  setConductorOverrideVersion,
} from "@argus/host/services/conductor/override";
import { listConductorVersions } from "@argus/host/services/conductor/registry";
import { checkDependencies } from "@argus/host/services/dependencies/check";
import { listHostDirectory } from "@argus/host/services/file/hostBrowse";
import {
  listSessionFiles,
  resolveMentionPath,
  readFile,
  writeFile,
  statFile,
  listPath,
} from "@argus/host/services/file/operations";
import { uploadSessionAttachment } from "@argus/host/services/file/uploads";
import { listGhIssues } from "@argus/host/services/github/issues";
import {
  ghPrClose,
  ghPrComment,
  ghPrCreate,
  ghPrMerge,
  type MergeStrategy,
} from "@argus/host/services/github/prActions";
import {
  getPullRequestDetail,
  getPullRequestDiff,
} from "@argus/host/services/github/prDetail";
import { listInterestingPullRequests } from "@argus/host/services/github/pullRequests";
import { captureUi } from "@argus/host/services/inspection/capture";
import { setNodeProperty } from "@argus/host/services/inspection/edit";
import {
  launchInjected,
  listInstalledApps,
  probeInjection,
} from "@argus/host/services/inspection/launcher";
import { getNodeProps } from "@argus/host/services/inspection/props";
import { CUSTOM_RUNNER_PRESETS } from "@argus/host/services/llm/customRunners/presets";
import {
  deleteCustomRunner,
  listCustomRunners,
  saveCustomRunner,
  type CustomRunner,
} from "@argus/host/services/llm/customRunners/store";
import {
  listRunners as listLlmRunners,
  syncCustomRunners,
} from "@argus/host/services/llm/registry";
import { setSessionRunner } from "@argus/host/services/llm/sessionRunner";
import { generateChatTitle } from "@argus/host/services/llm/titleGenerator";
import { testMcpServer } from "@argus/host/services/mcp/connectivity";
import {
  authenticate,
  cancelAuthentication,
  signOut,
} from "@argus/host/services/mcp/oauth";
import { listAuthorized, loadToken } from "@argus/host/services/mcp/oauthStore";
import { collectAllProjects } from "@argus/host/services/mcp/projectDiscovery";
import { listInheritedMcpServers } from "@argus/host/services/mcp/userConfig";
import {
  showAgentNotification,
  type AgentNotificationInput,
} from "@argus/host/services/notifications/osNotification";
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
} from "@argus/host/services/onboarding/index";
import { claimState } from "@argus/host/services/remote/deviceClaims";
import {
  listDevices as listRemoteDevices,
  revokeDevice,
  setDeviceGrants,
} from "@argus/host/services/remote/deviceStore";
import { disconnectDevice } from "@argus/host/services/remote/gateway";
import {
  approveGuest as approveHuddleGuest,
  denyGuest as denyHuddleGuest,
  listRooms as listHuddleRooms,
  removeGuest as removeHuddleGuest,
  setHuddleDevice,
  startHuddle,
  stopHuddle,
  sayInHuddle,
  setHuddleHostTyping,
} from "@argus/host/services/remote/huddleService";
import {
  cancelPairing,
  confirmPairing,
  startPairing,
} from "@argus/host/services/remote/pairing";
import {
  getPushConfigStatus,
  setPushConfig,
} from "@argus/host/services/remote/push/config";
import { sendTestPush } from "@argus/host/services/remote/push/dispatch";
import {
  getPublicUrl,
  getRemoteStatus,
  setRemoteConfig,
  setRemoteStatusListener,
} from "@argus/host/services/remote/remoteService";
import { checkShareReadiness } from "@argus/host/services/remote/shareReadiness";
import {
  applyTailscaleFix,
  diagnoseTailscale,
  type TailscaleFixKind,
} from "@argus/host/services/remote/tailscaleSetup";
import { reconfigureAutoFetchForRepo } from "@argus/host/services/session/autoFetch";
import { loadCommandMetrics } from "@argus/host/services/session/commandMetrics";
import { gitAmendTip } from "@argus/host/services/session/gitAmend";
import {
  gitBisectBad,
  gitBisectGood,
  gitBisectReset,
  gitBisectSkip,
  gitBisectStart,
  gitBisectStatus,
} from "@argus/host/services/session/gitBisect";
import { gitBlameFile } from "@argus/host/services/session/gitBlame";
import { gitReadBlobAtRef } from "@argus/host/services/session/gitBlob";
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
} from "@argus/host/services/session/gitBranchOps";
import { gitCompareBranches } from "@argus/host/services/session/gitCompare";
import {
  gitGetConfig,
  gitSetConfig,
} from "@argus/host/services/session/gitConfig";
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
} from "@argus/host/services/session/gitConflicts";
import {
  checkSshKeys,
  getGlobalCredentialHelper,
  setGlobalCredentialHelper,
} from "@argus/host/services/session/gitCredentials";
import {
  addToGitignore,
  gitDiscardFile,
  gitDiscardHunk,
  gitDiscardLines,
  gitUntrackFile,
} from "@argus/host/services/session/gitDiscard";
import {
  gitCherryPick,
  gitReset,
  gitRevert,
} from "@argus/host/services/session/gitHistoryOps";
import {
  gitListHooks,
  gitRunHook,
} from "@argus/host/services/session/gitHooks";
import { gitLfsFiles, gitLfsPull } from "@argus/host/services/session/gitLfs";
import { gitAm, gitFormatPatch } from "@argus/host/services/session/gitPatches";
import {
  gitPullV2,
  gitPushV2,
  type PullV2Opts,
  type PushV2Opts,
} from "@argus/host/services/session/gitPushPull";
import {
  gitRebaseAutosquash,
  gitRebaseInteractivePlan,
  gitRebaseInteractiveRun,
  type RebasePlanEntry,
} from "@argus/host/services/session/gitRebase";
import { gitReflog } from "@argus/host/services/session/gitReflog";
import {
  gitAddRemote,
  gitListRemotes,
  gitPruneRemote,
  gitRemoveRemote,
  gitRenameRemote,
  gitSetRemoteUrl,
} from "@argus/host/services/session/gitRemoteOps";
import {
  gitGetRemotes,
  gitListRecentIssues,
} from "@argus/host/services/session/gitRemotes";
import {
  gitDiffRange,
  gitFileHistory,
  gitSearchLog,
  type LogSearchCursor,
  type LogSearchFilters,
} from "@argus/host/services/session/gitSearch";
import { gitStatus } from "@argus/host/services/session/gitStatus";
import {
  gitSubmoduleDeinit,
  gitSubmoduleInit,
  gitSubmoduleList,
  gitSubmoduleUpdate,
} from "@argus/host/services/session/gitSubmodules";
import {
  gitCreateTag,
  gitDeleteTag,
  gitListTags,
  gitPushTag,
} from "@argus/host/services/session/gitTags";
import {
  gitListAssumeUnchangedFiles,
  gitListIgnoredFiles,
} from "@argus/host/services/session/gitWorkingCopyFilters";
import { gitWorktreeList } from "@argus/host/services/session/gitWorktrees";
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
} from "@argus/host/services/session/manager";
import { autofillPullRequestBody } from "@argus/host/services/session/prAutofill";
import { readPullRequestTemplate } from "@argus/host/services/session/pullRequest";
import {
  getSessionReleaseNotes,
  previewReleaseNotes,
} from "@argus/host/services/session/releaseNotes";
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
  setSessionClaudeAccount,
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
} from "@argus/host/services/session/sessionOps";
import {
  listEditors,
  openInCustomEditor,
  openInEditor,
} from "@argus/host/services/shell/editors";
import {
  openExternalUrl,
  openPath,
  revealInFinder,
} from "@argus/host/services/shell/operations";
import { describeSignalSources } from "@argus/host/services/signals/registry";
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
} from "@argus/host/services/simulator/android";
import { getDeviceInputEndpoint } from "@argus/host/services/simulator/deviceInput";
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
  simulatorDeviceState,
  simulatorKeyboard,
  simulatorSetFold,
  simulatorSetOrientation,
} from "@argus/host/services/simulator/ios";
import { getAnonymousId } from "@argus/host/services/telemetry/anonymousId";
import {
  capture as telemetryCapture,
  captureException as telemetryCaptureException,
  captureFeedback as telemetryCaptureFeedback,
  getTelemetryMode,
  isTelemetryConfigured,
  setTelemetryMode,
} from "@argus/host/services/telemetry/telemetry";
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
} from "@argus/host/services/terminal/multiplexer";
import {
  getEnabledToolsForRenderer,
  toolEnabled,
  setEnabledToolsFromRenderer,
} from "@argus/host/services/tools/state";
import { getUiState, setUiState } from "@argus/host/services/uiState";
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
} from "@argus/host/services/userProjectSettings/store";
import { appState } from "@argus/host/state";
import { createLogger } from "../app/lib/logger";
import {
  closeFloatingAgentWindow,
  closeFloatingDeviceWindow,
  createFloatingAgentWindow,
  createFloatingDeviceWindow,
  getMainWindow,
  markQuitConfirmedDespiteAgents,
} from "./main";
import { agentPopouts } from "./popouts";
import {
  checkForUpdates as updaterCheck,
  downloadUpdate as updaterDownload,
  getUpdaterState,
  quitAndInstallUpdate,
} from "./services/updater";

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
  tier: CommandTier,
  toolId: ToolId,
  handler: (args: Args) => Promise<unknown> | unknown,
): void {
  handle(channel, tier, (args) => {
    if (!toolEnabled(toolId)) {
      throw `tool disabled: ${toolId}`;
    }

    return handler(args);
  });
}

/** Helper: register a command in the registry, which publishes it on IPC. */
function handle(
  channel: string,
  tier: CommandTier,
  handler: (args: Args) => Promise<unknown> | unknown,
): void {
  defineCommand(channel, { tier, handler });
}

export function registerIpcHandlers(): void {
  // File commands
  handle("read_file", "admin", (a) =>
    readFile(a.id as string, a.relativePath as string),
  );
  handle("write_file", "admin", (a) =>
    writeFile(a.id as string, a.relativePath as string, a.content as string),
  );
  handle("stat_file", "admin", (a) =>
    statFile(a.id as string, a.relativePath as string),
  );
  handle("list_session_files", "admin", (a) =>
    listSessionFiles(a.id as string),
  );
  handle("resolve_mention_path", "admin", (a) =>
    resolveMentionPath(a.id as string, a.query as string),
  );

  // Attachment upload — a file dropped on a client whose disk the host does not
  // share arrives as bytes and lands in the session's staging directory.
  handle("upload_session_attachment", "admin", (a) =>
    uploadSessionAttachment(a.id as string, a.name as string, a.data as string),
  );

  // Absolute-path directory listing (used by the project-settings glob input).
  handle("list_path", "admin", (a) => listPath(a.path as string));

  // Host-side directory browser — how a remote client picks a project root,
  // since a native open dialog would draw on the wrong machine.
  handle("list_host_directory", "admin", (a) =>
    listHostDirectory(a.path as string | undefined),
  );

  // Window
  handle("close_window", "host", () => {
    getMainWindow()?.close();
  });

  // Quit-with-running-agents flow. Invoked by the renderer after the user
  // accepts the confirm dialog surfaced via `app:quit-request`. Stops each
  // running agent (best-effort, bounded by a short timeout) and then calls
  // app.quit(), which re-enters `before-quit` with the guard flag set.
  handle("app_confirm_quit", "admin", async () => {
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
  handle("app_cancel_quit", "admin", () => {
    createLogger("ipc:app_cancel_quit").info("user cancelled quit");
  });

  // Auto-updater
  handle("updater_get_state", "admin", () => getUpdaterState());
  handle("updater_check", "host", (a) =>
    updaterCheck({ silent: a.silent === true }),
  );
  handle("updater_download", "host", () => updaterDownload());
  handle("updater_quit_and_install", "host", () => {
    quitAndInstallUpdate();
  });

  // Session CRUD
  handle("list_interesting_pull_requests", "admin", (a) =>
    listInterestingPullRequests((a.repoRoots as string[]) ?? []),
  );

  handle("get_pull_request_detail", "admin", (a) =>
    getPullRequestDetail(
      a.owner as string,
      a.repo as string,
      a.number as number,
    ),
  );

  handle("get_pull_request_diff", "admin", (a) =>
    getPullRequestDiff(a.owner as string, a.repo as string, a.number as number),
  );

  handle("read_pr_template", "admin", (a) =>
    Promise.resolve(readPullRequestTemplate(a.repoRoot as string)),
  );

  handle("autofill_pr_template", "admin", (a) =>
    autofillPullRequestBody({
      sessionId: a.sessionId as string,
      title: a.title as string,
      baseBranch: a.baseBranch as string,
    }),
  );

  handle("gh_pr_create", "admin", (a) =>
    ghPrCreate({
      repoRoot: a.repoRoot as string,
      title: a.title as string,
      body: a.body as string,
      base: a.base as string,
      head: a.head as string,
      draft: (a.draft as boolean | undefined) ?? false,
    }),
  );

  handle("gh_pr_comment", "admin", (a) =>
    ghPrComment({
      owner: a.owner as string,
      repo: a.repo as string,
      number: a.number as number,
      body: a.body as string,
    }),
  );

  handle("gh_pr_merge", "admin", (a) =>
    ghPrMerge({
      owner: a.owner as string,
      repo: a.repo as string,
      number: a.number as number,
      strategy: a.strategy as MergeStrategy,
    }),
  );

  handle("gh_pr_close", "admin", (a) =>
    ghPrClose({
      owner: a.owner as string,
      repo: a.repo as string,
      number: a.number as number,
    }),
  );

  handle("gh_list_issues", "admin", (a) => listGhIssues(a.repoRoot as string));

  handle("add_repo_root", "admin", (a) => addRepoRoot(a.path as string));
  handle("remove_repo_root", "admin", (a) => removeRepoRoot(a.path as string));
  handle("list_projects", "admin", () => collectAllProjects());

  // One snapshot of everything this backend is running. Local IPC never drops
  // so the desktop never needs it; a client attaching over the gateway does —
  // on connect and after every reconnect (§3.5).
  handle("state_hydrate", "admin", async () => {
    const projects = await collectAllProjects();
    const sessions: Session[] = [];
    const agents: AgentInfo[] = [];
    for (const project of projects.filter((p) => p.registered)) {
      const projectSessions = await listSessions(project.path);
      sessions.push(...projectSessions);
      for (const session of projectSessions) {
        agents.push(...listAgents(session.id));
      }
    }

    return { projects, sessions, agents };
  });
  handle("list_sessions", "admin", (a) => listSessions(a.repoRoot as string));
  handle("create_session", "admin", (a) =>
    createSession(
      a.repoRoot as string,
      a.branch as string,
      a.description as string,
      a.useExistingBranch as boolean | undefined,
      a.baseBranch as string | undefined,
      a.llm as { runner?: string | null; model?: string | null } | undefined,
    ),
  );
  handle("create_project_root_session", "admin", (a) =>
    createHeadSession(a.repoRoot as string),
  );
  handle("delete_session", "admin", (a) =>
    deleteSession(a.id as string, a.shouldDeleteBranch as boolean | undefined),
  );
  handle("rename_session", "admin", (a) =>
    renameSession(a.id as string, a.displayName as string),
  );
  handle("rename_session_branch", "admin", (a) =>
    renameSessionBranch(a.id as string, a.branch as string),
  );
  handle("clear_session_setup_error", "admin", (a) =>
    clearSessionSetupError(a.id as string),
  );
  handle("retry_session_setup", "admin", (a) =>
    retrySessionSetup(a.id as string),
  );
  handle("fork_session", "admin", (a) =>
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
  handle("fork_chat_in_session", "admin", (a) =>
    forkChatInSession(
      a.sourceSessionId as string,
      a.sourceClaudeSessionId as string,
      a.forkTimestampMs as number,
      a.forkTurnNumber as number,
    ),
  );

  // Session ops
  handle("get_repo_branch", "admin", (a) =>
    getRepoBranch(a.repoRoot as string),
  );
  handle("list_branches", "admin", (a) => listBranches(a.repoRoot as string));
  handle("list_all_branches", "admin", (a) =>
    listAllBranches(a.repoRoot as string),
  );
  handle("checkout_branch", "admin", (a) =>
    checkoutBranch(a.repoRoot as string, a.branch as string),
  );

  // Phase 6 P2 / P5 — project-root branch listing + ops (session-keyed,
  // gated to project_root sessions on the backend for mutating ops).
  handle("git_list_local_branches", "admin", (a) =>
    gitListLocalBranches(a.id as string),
  );
  handle("git_list_remote_branches", "admin", (a) =>
    gitListRemoteBranches(a.id as string),
  );
  handle("git_create_branch", "admin", (a) =>
    gitCreateBranch(a.id as string, {
      name: a.name as string,
      startPoint: a.startPoint as string | undefined,
      checkout: a.checkout as boolean | undefined,
    }),
  );
  handle("git_delete_branch", "admin", (a) =>
    gitDeleteBranch(a.id as string, {
      name: a.name as string,
      force: a.force as boolean | undefined,
    }),
  );
  handle("git_rename_branch", "admin", (a) =>
    gitRenameBranch(a.id as string, {
      from: a.from as string,
      to: a.to as string,
    }),
  );
  handle("git_checkout", "admin", (a) =>
    gitCheckout(a.id as string, {
      branch: a.branch as string,
      create: a.create as boolean | undefined,
    }),
  );
  handle("git_set_upstream", "admin", (a) =>
    gitSetUpstream(a.id as string, {
      branch: a.branch as string,
      upstream: a.upstream as string,
    }),
  );
  handle("git_merge_branch", "admin", (a) =>
    gitMergeBranch(a.id as string, {
      from: a.from as string,
      into: a.into as string | undefined,
      squash: a.squash as boolean | undefined,
    }),
  );
  handle("git_stash_and_checkout", "admin", (a) =>
    gitStashAndCheckout(a.id as string, { branch: a.branch as string }),
  );
  handle("git_discard_and_checkout", "admin", (a) =>
    gitDiscardAndCheckout(a.id as string, { branch: a.branch as string }),
  );
  handle("git_rebase_onto", "admin", (a) =>
    gitRebaseOnto(a.id as string, {
      upstream: a.upstream as string,
      branch: a.branch as string | undefined,
    }),
  );
  handle("get_session_diff", "admin", (a) => getSessionDiff(a.id as string));
  handle("get_session_full_diff", "admin", (a) =>
    getSessionFullDiff(a.id as string),
  );
  handle("get_session_branch_diff", "admin", (a) =>
    getSessionBranchDiff(a.id as string, {
      ignoreWhitespace: a.ignoreWhitespace as boolean | undefined,
      wordDiff: a.wordDiff as boolean | undefined,
    }),
  );
  handle("get_session_staged_diff", "admin", (a) =>
    getSessionStagedDiff(a.id as string, {
      ignoreWhitespace: a.ignoreWhitespace as boolean | undefined,
      wordDiff: a.wordDiff as boolean | undefined,
    }),
  );
  handle("get_session_untracked_diff", "admin", (a) =>
    getSessionUntrackedDiff(a.id as string),
  );
  handle("get_session_status", "admin", (a) =>
    getSessionStatus(a.id as string),
  );
  handle("git_status", "admin", (a) => gitStatus(a.id as string));
  handle("git_list_ignored_files", "admin", (a) =>
    gitListIgnoredFiles(a.id as string),
  );
  handle("git_list_assume_unchanged_files", "admin", (a) =>
    gitListAssumeUnchangedFiles(a.id as string),
  );
  handle("stage_file", "admin", (a) =>
    stageFile(a.id as string, a.filePath as string),
  );
  handle("stage_all", "admin", (a) => stageAll(a.id as string));
  handle("unstage_file", "admin", (a) =>
    unstageFile(a.id as string, a.filePath as string),
  );
  handle("unstage_all", "admin", (a) => unstageAll(a.id as string));
  handle("discard_file", "admin", (a) =>
    discardFile(a.id as string, a.filePath as string),
  );
  handle("stage_hunk", "admin", (a) =>
    stageHunk(a.id as string, a.patch as string),
  );
  handle("unstage_hunk", "admin", (a) =>
    unstageHunk(a.id as string, a.patch as string),
  );
  handle("discard_hunk", "admin", (a) =>
    discardHunk(a.id as string, a.patch as string, a.staged as boolean),
  );
  handle("git_commit", "admin", (a) =>
    gitCommit(a.id as string, a.message as string, a.amend as boolean),
  );
  handle("get_git_author", "admin", (a) => getGitAuthor(a.id as string));
  handle("get_last_commit_message", "admin", (a) =>
    getLastCommitMessage(a.id as string),
  );
  handle("get_last_commit_hash", "admin", (a) =>
    getLastCommitHash(a.id as string),
  );
  handle("watch_session", "admin", (a) => watchSession(a.id as string));
  handle("unwatch_session", "admin", (a) => unwatchSession(a.id as string));
  handle("pause_all_watchers", "admin", () => pauseAllWatchers());
  handle("resume_all_watchers", "admin", () => resumeAllWatchers());
  handle("read_argus_config", "admin", (a) =>
    readArgusConfig(a.repoRoot as string),
  );
  handle("write_argus_config", "admin", (a) =>
    writeArgusConfig(a.repoRoot as string, a.content as string),
  );
  handle("get_user_project_settings", "admin", (a) =>
    loadUserProjectSettings(a.repoRoot as string),
  );
  handle("set_user_project_settings", "admin", (a) =>
    saveUserProjectSettings(
      a.repoRoot as string,
      a.settings as UserProjectSettings,
    ),
  );
  handle("git_archive_branch", "admin", (a) =>
    archiveBranchSetting(a.repoRoot as string, a.branch as string),
  );
  handle("git_unarchive_branch", "admin", (a) =>
    unarchiveBranchSetting(a.repoRoot as string, a.branch as string),
  );
  handle("git_list_archived_branches", "admin", (a) =>
    listArchivedBranchesSetting(a.repoRoot as string),
  );
  handle("git_pin_branch", "admin", (a) =>
    pinBranchSetting(a.repoRoot as string, a.branch as string),
  );
  handle("git_unpin_branch", "admin", (a) =>
    unpinBranchSetting(a.repoRoot as string, a.branch as string),
  );
  handle("git_list_pinned_branches", "admin", (a) =>
    listPinnedBranchesSetting(a.repoRoot as string),
  );
  // Automations — host state, deliberately remotable so a desktop driving a
  // headless mini manages the mini's automations as if they were its own.
  handle("automations_list", "admin", () => listAutomations());
  handle("automation_create", "admin", (a) =>
    createAutomation(a.input as CreateAutomationInput),
  );
  handle("automation_update", "admin", (a) =>
    updateAutomation(a.id as string, a.patch as UpdateAutomationInput),
  );
  handle("automation_delete", "admin", (a) => {
    deleteAutomation(a.id as string);
  });
  handle("automation_set_enabled", "admin", (a) =>
    setAutomationEnabled(a.id as string, a.enabled as boolean),
  );
  handle("automation_run_now", "admin", (a) =>
    startAutomationRun(a.id as string, "manual"),
  );
  handle("automation_cancel_run", "admin", (a) =>
    cancelAutomationRun(a.runId as string),
  );
  handle("automation_runs_list", "admin", (a) =>
    listAutomationRuns(a.automationId as string | undefined),
  );
  handle("automation_run_get", "admin", (a) =>
    getAutomationRun(a.runId as string),
  );
  handle("automation_run_mark_read", "admin", (a) =>
    markRunReportRead(a.runId as string),
  );
  handle("automation_run_delete", "admin", (a) => deleteRun(a.runId as string));
  handle("signal_sources_list", "admin", () => describeSignalSources());
  handle("automation_gate_log_list", "admin", () => listGateLog());
  handle("automation_gate_log_dismiss", "admin", (a) =>
    dismissGateLogEntry(a.id as string),
  );
  handle("automation_gate_log_clear", "admin", () => clearGateLog());
  // Drafting is deliberately separate from creating: what comes back is a
  // draft the user reviews and saves, never a live automation.
  handle("automation_draft", "admin", (a) =>
    draftAutomation({
      description: a.description as string,
      timezone: a.timezone as string | undefined,
    }),
  );
  handle("automation_calibration", "admin", (a) =>
    calibrationFor(a.automationId as string),
  );
  // Ad-hoc runs: a playbook run once, with no automation persisted for it.
  // Admin-tier and remotable like the rest — running something one-off on a
  // headless mini from the desktop is the same act as pressing Run now there.
  handle("automation_run_scratch", "admin", (a) =>
    startScratchRun(a.input as StartScratchRunInput),
  );
  handle("automation_scratch_save", "admin", (a) =>
    saveScratchRunAsAutomation(a.runId as string, {
      name: a.name as string | undefined,
      description: a.description as string | undefined,
    }),
  );
  handle("automation_scratch_runs_list", "admin", () => listScratchRuns());
  // Proposals — what a run wants you to do. Remotable for the same reason the
  // automations are: the inbox belongs to whichever machine runs the clock.
  handle("proposals_list", "admin", (a) =>
    listProposals({
      automationId: a.automationId as string | undefined,
      runId: a.runId as string | undefined,
      status: a.status as ProposalStatus | undefined,
    }),
  );
  handle("proposal_get", "admin", (a) => getProposal(a.id as string));
  handle("proposal_accept", "admin", (a) =>
    acceptProposal(a.id as string, { note: a.note as string | undefined }),
  );
  handle("proposal_request_revision", "admin", (a) =>
    requestProposalRevision(a.id as string, a.note as string),
  );
  handle("proposal_perform_cleanup", "admin", (a) =>
    performProposalCleanup(a.id as string),
  );
  handle("proposal_dismiss", "admin", (a) =>
    dismissProposal(a.id as string, a.reason as string | undefined),
  );

  handle("get_app_settings", "admin", () => loadAppSettings());
  handle("set_app_settings", "admin", (a) =>
    saveAppSettings(a.settings as AppSettings),
  );

  // Remote access (phone/web control).
  handle("remote_get_status", "admin", () => getRemoteStatus());
  handle("remote_set_config", "host", (a) =>
    setRemoteConfig(
      a.config as {
        cloudflareEnabled?: boolean;
        enabled?: boolean;
        lanWeb?: boolean;
        notifyWhenFocused?: boolean;
        publicUrl?: string;
        tailscaleEnabled?: boolean;
        tunnelMode?: "quick" | "token";
        tunnelToken?: string;
      },
    ),
  );
  // Reconfiguring how the host is reachable is console-only, like pairing.
  handle("remote_tailscale_diagnose", "host", () => diagnoseTailscale());
  handle("remote_tailscale_fix", "host", async (a) => {
    const result = await applyTailscaleFix(
      a.fix as TailscaleFixKind,
      a.url as string | undefined,
    );
    // Browser-completed fixes (sign-in, enabling Funnel) hand back a URL.
    if (result.openUrl) {
      openExternalUrl(result.openUrl);
    }

    return result;
  });
  handle("remote_get_push_config", "admin", () => getPushConfigStatus());
  handle("remote_set_push_config", "admin", (a) => {
    const patch = a.patch as { enabled?: boolean; vapidSubject?: string };

    return setPushConfig({
      ...(patch.enabled !== undefined ? { enabled: patch.enabled } : {}),
      ...(patch.vapidSubject !== undefined
        ? { vapid_subject: patch.vapidSubject.trim() }
        : {}),
    });
  });
  handle("remote_test_push", "admin", (a) =>
    sendTestPush(a.deviceId as string),
  );
  handle("remote_list_devices", "admin", () => listRemoteDevices());
  handle("remote_revoke_device", "host", async (a) => {
    const deviceId = a.deviceId as string;
    await revokeDevice(deviceId);
    disconnectDevice(deviceId);

    return getRemoteStatus();
  });
  handle("remote_start_pairing", "host", () =>
    startPairing(getPublicUrl(), {
      onSas: (sas, client) =>
        emitHostEvent("remote:pairing-sas", { sas, client }),
      onPaired: (device) =>
        emitHostEvent("remote:pairing-complete", { device }),
      onError: (message) => emitHostEvent("remote:pairing-error", { message }),
    }),
  );
  handle("remote_confirm_pairing", "host", (a) =>
    confirmPairing({
      control: a.control === true,
      admin: a.admin === true,
    }),
  );
  handle("remote_cancel_pairing", "host", () => {
    cancelPairing();
  });
  handle("remote_set_device_control", "host", async (a) => {
    const deviceId = a.deviceId as string;
    await setDeviceGrants(deviceId, {
      control: a.control === true,
      admin: a.admin === true,
    });
    // Drop any live connection so it reconnects with the fresh grants — the
    // gateway pins capabilities per-connection at handshake time.
    disconnectDevice(deviceId);

    return listRemoteDevices();
  });
  // Huddles — sharing one agent and one device over a temporary link. Host
  // tier throughout: minting a link, letting a guest in and ending a share are
  // trust decisions, and a room token must never leave this machine's console.
  handle("huddle_start", "host", (a) =>
    startHuddle({
      agent_id: a.agentId as string,
      device_key: (a.deviceKey as string | null) ?? "",
      host_label: (a.hostLabel as string | undefined) ?? "",
    }),
  );
  // Asked before the user commits to sharing, so a missing prerequisite is
  // explained in the dialog instead of thrown after the spinner.
  handle("huddle_share_readiness", "host", () => checkShareReadiness());
  handle("huddle_stop", "host", (a) => stopHuddle(a.roomId as string));
  handle("huddle_set_device", "host", (a) =>
    setHuddleDevice(a.roomId as string, (a.deviceKey as string | null) ?? ""),
  );
  handle("huddle_list", "host", () => listHuddleRooms());
  // The engineer's own input is never arbitrated, so the desktop asks purely to
  // show who among the guests is driving what it has shared.
  handle("device_claim_status", "admin", (a) =>
    Promise.resolve(claimState(a.deviceId as string)),
  );
  handle("huddle_say", "host", (a) =>
    Promise.resolve(sayInHuddle(a.roomId as string, a.text as string)),
  );
  handle("huddle_set_typing", "host", (a) =>
    setHuddleHostTyping(a.roomId as string, a.typing as boolean),
  );
  handle("huddle_approve_guest", "host", (a) =>
    approveHuddleGuest(a.roomId as string, a.devStaticPub as string),
  );
  handle("huddle_deny_guest", "host", (a) =>
    denyHuddleGuest(a.roomId as string, a.devStaticPub as string),
  );
  handle("huddle_remove_guest", "host", (a) =>
    removeHuddleGuest(a.roomId as string, a.devStaticPub as string),
  );
  // Push status to the renderer whenever the tunnel state changes (e.g. a quick
  // tunnel finishing startup and revealing its URL).
  setRemoteStatusListener(() => {
    getRemoteStatus()
      .then((status) => emitHostEvent("remote:status", status))
      .catch(() => {});
  });
  handle("list_inherited_mcp_servers", "admin", (a) =>
    listInheritedMcpServers((a.worktreePath as string | null) ?? null),
  );
  handle("test_mcp_server", "admin", (a) =>
    testMcpServer(a.config as Record<string, unknown>),
  );
  handle("mcp_oauth_sign_in", "admin", (a) =>
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
  handle("mcp_oauth_sign_out", "admin", (a) => signOut(a.serverUrl as string));
  handle("mcp_oauth_cancel_sign_in", "admin", (a) =>
    Promise.resolve(cancelAuthentication(a.serverUrl as string)),
  );
  handle("mcp_oauth_status", "admin", async (a) => {
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
  handle("mcp_oauth_list_authorized", "admin", () => listAuthorized());
  handle("get_command_metrics", "admin", (a) =>
    loadCommandMetrics(a.repoRoot as string),
  );
  handle("set_session_base_branch", "admin", (a) =>
    setSessionBaseBranch(a.id as string, a.baseBranch as string),
  );
  handle("set_session_claude_account", "admin", (a) => {
    setSessionClaudeAccount(
      a.sessionId as string,
      (a.accountId as string | null) ?? null,
    );

    return null;
  });
  handle("get_session_conflicts", "admin", (a) =>
    getSessionConflicts(a.id as string),
  );
  handle("get_session_merge_blockers", "admin", (a) =>
    getSessionMergeBlockers(a.id as string),
  );
  handle("get_session_release_notes", "admin", (a) =>
    getSessionReleaseNotes(a.id as string),
  );
  handle("preview_release_notes", "admin", (a) =>
    previewReleaseNotes(
      a.repoRoot as string,
      a.patterns as Parameters<typeof previewReleaseNotes>[1],
    ),
  );
  handle("get_session_commits_ahead", "admin", (a) =>
    getSessionCommitsAhead(a.id as string),
  );
  handle("merge_session_into_base", "admin", (a) =>
    mergeSessionIntoBase(a.id as string),
  );
  handle("get_session_commits_behind", "admin", (a) =>
    getSessionCommitsBehind(a.id as string),
  );
  handle("rebase_session_on_base", "admin", (a) =>
    rebaseSessionOnBase(a.id as string),
  );
  handle("push_session_branch", "admin", (a) =>
    pushSessionBranch(a.id as string),
  );
  handle("git_pull", "admin", (a) =>
    gitPull(
      a.id as string,
      a.remoteBranch as string | undefined,
      a.rebase as boolean | undefined,
    ),
  );
  handle("git_push", "admin", (a) => gitPush(a.id as string));
  handle("git_fetch", "admin", (a) => gitFetch(a.id as string));
  handle("git_stash", "admin", (a) => gitStash(a.id as string));
  handle("git_stash_save", "admin", (a) =>
    gitStashSave(a.id as string, {
      message: a.message as string | undefined,
      includeUntracked: a.includeUntracked as boolean | undefined,
      keepIndex: a.keepIndex as boolean | undefined,
      paths: a.paths as string[] | undefined,
    }),
  );
  handle("git_stash_branch", "admin", (a) =>
    gitStashBranch(
      a.id as string,
      a.stashRef as string,
      a.branchName as string,
    ),
  );
  handle("git_stash_pop", "admin", (a) => gitStashPop(a.id as string));
  handle("git_log", "admin", (a) =>
    gitLog(
      a.id as string,
      (a.count as number | undefined) ?? 100,
      (a.allBranches as boolean | undefined) ?? true,
    ),
  );
  handle("git_show_commit", "admin", (a) =>
    gitShowCommit(a.id as string, a.commitHash as string),
  );
  handle("git_stash_list", "admin", (a) => gitStashList(a.id as string));
  handle("git_stash_show", "admin", (a) =>
    gitStashShow(a.id as string, a.stashIndex as number),
  );
  handle("git_stash_apply", "admin", (a) =>
    gitStashApply(a.id as string, a.stashIndex as number),
  );
  handle("git_stash_drop", "admin", (a) =>
    gitStashDrop(a.id as string, a.stashIndex as number),
  );
  handle("git_checkout_paths", "admin", (a) =>
    gitCheckoutPaths(a.id as string, a.ref as string, a.paths as string[]),
  );

  // Phase 2 W5 — discard / untrack / .gitignore
  handle("git_discard_file", "admin", (a) =>
    gitDiscardFile(a.id as string, a.filePath as string),
  );
  handle("git_discard_hunk", "admin", (a) =>
    gitDiscardHunk(a.id as string, a.hunkPatch as string),
  );
  handle("git_discard_lines", "admin", (a) =>
    gitDiscardLines(
      a.id as string,
      a.filePath as string,
      (a.lines as number[]) ?? [],
      (a.side as "new" | "old") ?? "new",
      a.hunkPatch as string,
    ),
  );
  handle("git_untrack_file", "admin", (a) =>
    gitUntrackFile(a.id as string, a.filePath as string),
  );
  handle("add_to_gitignore", "admin", (a) =>
    addToGitignore(a.id as string, a.filePath as string),
  );

  // Phase 2 W9 — conflict resolution
  handle("git_continue_merge", "admin", (a) =>
    gitContinueMerge(a.id as string),
  );
  handle("git_abort_merge", "admin", (a) => gitAbortMerge(a.id as string));
  handle("git_continue_rebase", "admin", (a) =>
    gitContinueRebase(a.id as string),
  );
  handle("git_abort_rebase", "admin", (a) => gitAbortRebase(a.id as string));
  handle("git_skip_rebase", "admin", (a) => gitSkipRebase(a.id as string));
  handle("git_continue_cherry_pick", "admin", (a) =>
    gitContinueCherryPick(a.id as string),
  );
  handle("git_abort_cherry_pick", "admin", (a) =>
    gitAbortCherryPick(a.id as string),
  );
  handle("git_get_conflict", "admin", (a) =>
    gitGetConflict(a.id as string, a.filePath as string),
  );
  handle("git_mark_resolved", "admin", (a) =>
    gitMarkResolved(a.id as string, a.filePath as string),
  );
  handle("git_write_conflict_merged", "admin", (a) =>
    gitWriteConflictMerged(
      a.id as string,
      a.filePath as string,
      a.contents as string,
    ),
  );

  // Phase 2 W10 — git config get/set (per-repo)
  handle("git_get_config", "admin", (a) =>
    gitGetConfig(a.id as string, a.key as string),
  );
  handle("git_set_config", "admin", (a) =>
    gitSetConfig(a.id as string, a.key as string, a.value as string),
  );

  // Phase 2 W10 — remotes + issue autocomplete scaffold
  handle("git_get_remotes", "admin", (a) => gitGetRemotes(a.id as string));
  handle("git_list_recent_issues", "admin", (a) =>
    gitListRecentIssues(a.id as string, (a.query as string | undefined) ?? ""),
  );

  handle("git_amend_tip", "admin", (a) =>
    gitAmendTip(a.id as string, a.subject as string, a.body as string),
  );

  // Phase 4 H1 / H4 / H8 / H7 / H9 — history depth
  handle("git_search_log", "admin", (a) =>
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
  handle("git_diff_range", "admin", (a) =>
    gitDiffRange(a.id as string, a.fromRef as string, a.toRef as string),
  );
  handle("git_file_history", "admin", (a) =>
    gitFileHistory(a.id as string, a.path as string),
  );
  handle("git_blame_file", "admin", (a) =>
    gitBlameFile(
      a.id as string,
      a.path as string,
      (a.ref as string | undefined) ?? undefined,
    ),
  );
  // Phase 7 image-diff — read binary blob as base64
  handle("git_read_blob_at_ref", "admin", (a) =>
    gitReadBlobAtRef(a.id as string, a.path as string, a.ref as string),
  );
  handle("git_reflog", "admin", (a) =>
    gitReflog(a.id as string, {
      limit: a.limit as number | undefined,
      ref: a.ref as string | undefined,
    }),
  );

  // Phase 6B P7 — tags
  handle("git_list_tags", "admin", (a) => gitListTags(a.id as string));
  handle("git_create_tag", "admin", (a) =>
    gitCreateTag(a.id as string, {
      name: a.name as string,
      ref: a.ref as string | undefined,
      message: a.message as string | undefined,
      sign: a.sign as boolean | undefined,
      force: a.force as boolean | undefined,
    }),
  );
  handle("git_delete_tag", "admin", (a) =>
    gitDeleteTag(a.id as string, { name: a.name as string }),
  );
  handle("git_push_tag", "admin", (a) =>
    gitPushTag(a.id as string, {
      name: a.name as string | undefined,
      all: a.all as boolean | undefined,
      remote: a.remote as string | undefined,
    }),
  );

  // Phase 6B P8 — remotes (rich)
  handle("git_list_remotes", "admin", (a) => gitListRemotes(a.id as string));
  handle("git_add_remote", "admin", (a) =>
    gitAddRemote(a.id as string, {
      name: a.name as string,
      url: a.url as string,
    }),
  );
  handle("git_remove_remote", "admin", (a) =>
    gitRemoveRemote(a.id as string, { name: a.name as string }),
  );
  handle("git_rename_remote", "admin", (a) =>
    gitRenameRemote(a.id as string, {
      from: a.from as string,
      to: a.to as string,
    }),
  );
  handle("git_set_remote_url", "admin", (a) =>
    gitSetRemoteUrl(a.id as string, {
      name: a.name as string,
      url: a.url as string,
      push: a.push as boolean | undefined,
    }),
  );
  handle("git_prune_remote", "admin", (a) =>
    gitPruneRemote(a.id as string, { name: a.name as string }),
  );

  // Phase 6B P11 — push/pull v2
  handle("git_push_v2", "admin", (a) =>
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
  handle("git_pull_v2", "admin", (a) =>
    gitPullV2(a.id as string, {
      strategy: a.strategy as PullV2Opts["strategy"],
      prune: a.prune as boolean | undefined,
      tags: a.tags as boolean | undefined,
      remote: a.remote as string | undefined,
      branch: a.branch as string | undefined,
    }),
  );

  // Phase 6B P12 — reset / revert / cherry-pick
  handle("git_reset", "admin", (a) =>
    gitReset(a.id as string, {
      ref: a.ref as string,
      mode: a.mode as "hard" | "mixed" | "soft",
    }),
  );
  handle("git_revert", "admin", (a) =>
    gitRevert(a.id as string, {
      hash: a.hash as string,
      noCommit: a.noCommit as boolean | undefined,
    }),
  );
  handle("git_cherry_pick", "admin", (a) =>
    gitCherryPick(a.id as string, {
      hash: a.hash as string[] | string,
      noCommit: a.noCommit as boolean | undefined,
    }),
  );

  // Phase 6B P9 — submodules
  handle("git_submodule_list", "admin", (a) =>
    gitSubmoduleList(a.id as string),
  );
  handle("git_submodule_init", "admin", (a) =>
    gitSubmoduleInit(a.id as string, {
      path: a.path as string | undefined,
    }),
  );
  handle("git_submodule_update", "admin", (a) =>
    gitSubmoduleUpdate(a.id as string, {
      path: a.path as string | undefined,
      remote: a.remote as boolean | undefined,
    }),
  );
  handle("git_submodule_deinit", "admin", (a) =>
    gitSubmoduleDeinit(a.id as string, {
      path: a.path as string,
      force: a.force as boolean | undefined,
    }),
  );

  // Phase 6B P10 — worktrees
  handle("git_worktree_list", "admin", (a) => gitWorktreeList(a.id as string));

  // Phase 7 T1/T2 — interactive rebase
  handle("git_rebase_interactive_plan", "admin", (a) =>
    gitRebaseInteractivePlan(a.id as string, {
      upstream: a.upstream as string,
    }),
  );
  handle("git_rebase_interactive_run", "admin", (a) =>
    gitRebaseInteractiveRun(a.id as string, {
      upstream: a.upstream as string,
      plan: a.plan as RebasePlanEntry[],
    }),
  );
  handle("git_rebase_autosquash", "admin", (a) =>
    gitRebaseAutosquash(a.id as string, {
      upstream: a.upstream as string,
    }),
  );

  // Phase 7 T3 — bisect
  handle("git_bisect_start", "admin", (a) =>
    gitBisectStart(a.id as string, {
      goodRef: a.goodRef as string,
      badRef: a.badRef as string,
    }),
  );
  handle("git_bisect_good", "admin", (a) => gitBisectGood(a.id as string));
  handle("git_bisect_bad", "admin", (a) => gitBisectBad(a.id as string));
  handle("git_bisect_skip", "admin", (a) => gitBisectSkip(a.id as string));
  handle("git_bisect_reset", "admin", (a) => gitBisectReset(a.id as string));
  handle("git_bisect_status", "admin", (a) => gitBisectStatus(a.id as string));

  // Phase 7 T5 — credential helpers
  handle("check_ssh_keys", "admin", () => checkSshKeys());
  handle("get_global_credential_helper", "admin", () =>
    getGlobalCredentialHelper(),
  );
  handle("set_global_credential_helper", "admin", (a) =>
    setGlobalCredentialHelper(a.name as "osxkeychain" | "store"),
  );

  // Phase 7 T6 — git LFS
  handle("git_lfs_files", "admin", (a) => gitLfsFiles(a.id as string));
  handle("git_lfs_pull", "admin", (a) =>
    gitLfsPull(a.id as string, {
      paths: a.paths as string[] | undefined,
    }),
  );

  // Phase 7 T7 — patches
  handle("git_format_patch", "admin", (a) =>
    gitFormatPatch(a.id as string, {
      range: a.range as string,
      outputDir: a.outputDir as string | undefined,
    }),
  );
  handle("git_am", "admin", (a) =>
    gitAm(a.id as string, { patchPaths: a.patchPaths as string[] }),
  );

  // Phase 7 T8 — hooks
  handle("git_list_hooks", "admin", (a) => gitListHooks(a.id as string));
  handle("git_run_hook", "admin", (a) =>
    gitRunHook(a.id as string, { name: a.name as string }),
  );

  // Dependency / system probes
  handle("check_dependencies", "admin", () => checkDependencies());

  // UI state
  handle("ui_state_get", "admin", (a) => getUiState(a.key as string));
  handle("ui_state_set", "admin", (a) => {
    setUiState(a.key as string, a.value as string);

    return null;
  });

  // Agent commands
  handle("check_claude_cli", "admin", () => checkClaudeCli());
  handle("start_agent", "admin", async (a) => {
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
    emitHostEvent("agent:started", info);

    return info;
  });
  handle("stop_agent", "admin", (a) => stopAgent(a.agentId as string));
  handle("restore_agent_at_turn", "admin", (a) =>
    restoreAgentAtTurn({
      agentId: a.agentId as string,
      sourceClaudeSessionId: a.sourceClaudeSessionId as string,
      keepTurnNumber: a.keepTurnNumber as number,
      cutoffTimestampMs: a.cutoffTimestampMs as number,
    }),
  );
  handle("interrupt_agent", "admin", (a) =>
    interruptAgent(a.agentId as string),
  );
  handle("send_agent_message", "admin", (a) =>
    sendAgentMessage(
      a.agentId as string,
      a.message as string,
      a.images as { data: string; media_type: string }[] | undefined,
    ),
  );
  handle("list_agents", "admin", (a) => listAgents(a.sessionId as string));
  handle("respond_to_permission", "admin", (a) =>
    respondToPermission(
      a.agentId as string,
      a.toolUseId as string,
      a.decision as "allow" | "deny",
      a.allowRule as string | undefined,
      a.allowAll as boolean | undefined,
      a.denyMessage as string | undefined,
    ),
  );
  handle("set_agent_model", "admin", (a) =>
    setAgentModel(a.agentId as string, a.model as string),
  );
  handle("set_agent_permission_mode", "admin", (a) =>
    setAgentPermissionMode(a.agentId as string, a.mode as string),
  );
  handle("set_agent_effort", "admin", (a) =>
    setAgentEffort(a.agentId as string, (a.level as string | null) ?? null),
  );
  handle("prewarm_agent", "admin", (a) => prewarmAgent(a.sessionId as string));
  handle("claim_prewarm_agent", "admin", (a) =>
    claimPrewarmAgent(a.agentId as string, {
      model: a.model as string | undefined,
      permissionMode: a.permissionMode as string | undefined,
    }),
  );
  handle("discard_prewarm_agent", "admin", (a) =>
    discardPrewarmAgent(a.agentId as string),
  );

  // Checkpoint commands — snapshot the worktree before each user prompt so
  // it can later be restored from a chat message.
  handle("create_checkpoint", "admin", (a) =>
    createCheckpoint(a.sessionId as string),
  );
  handle("restore_checkpoint", "admin", (a) =>
    restoreCheckpoint(a.sessionId as string, a.checkpointId as string),
  );
  handle("delete_checkpoint", "admin", (a) =>
    deleteCheckpoint(a.sessionId as string, a.checkpointId as string),
  );

  // Chat history commands
  handle("save_chat_history", "admin", (a) =>
    saveConversation(
      a.repoRoot as string,
      a.conversation as Parameters<typeof saveConversation>[1],
    ),
  );
  handle("list_chat_history", "admin", (a) =>
    loadHistoryIndex(a.repoRoot as string),
  );
  handle("search_chat_history", "admin", (a) =>
    searchChatHistory(a.repoRoot as string, a.query as string),
  );
  handle("load_chat_history", "admin", (a) =>
    loadConversation(a.repoRoot as string, a.historyId as string),
  );
  handle("delete_chat_history", "admin", (a) =>
    deleteHistoryEntry(a.repoRoot as string, a.historyId as string),
  );
  handle("generate_session_title", "admin", (a) =>
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
  handle("create_terminal", "admin", (a) =>
    createTerminal(
      a.sessionId as string,
      a.subDir as string | undefined,
      undefined,
      a.title as string | undefined,
    ),
  );
  handle("create_run_terminal", "admin", (a) =>
    createRunTerminal(a.sessionId as string, a.title as string | undefined),
  );
  handle("list_terminals", "admin", (a) =>
    listTerminals(a.sessionId as string),
  );
  handle("update_terminal_title", "admin", (a) =>
    updateTerminalTitle(a.terminalId as string, a.title as string),
  );
  handle("start_terminal", "admin", (a) =>
    startTerminal(a.sessionId as string, a.cols as number, a.rows as number),
  );
  handle("destroy_terminal", "admin", (a) =>
    destroyTerminal(a.sessionId as string),
  );
  handle("stop_terminal", "admin", (a) => stopTerminal(a.sessionId as string));
  handle("terminal_write", "admin", (a) =>
    terminalWrite(a.sessionId as string, a.data as string),
  );
  handle("terminal_resize", "admin", (a) =>
    terminalResize(a.sessionId as string, a.cols as number, a.rows as number),
  );

  // Simulator commands. The picker (`list_simulators`) and Xcode probe stay
  // ungated — they're cheap, and the renderer uses them to show "Install
  // Xcode" hints regardless of tool state. Capture and HID input are gated.
  handle("check_ios_tools", "admin", () => checkIosTools());
  handle("list_simulators", "admin", () => listSimulators());
  handle("boot_simulator", "admin", (a) => bootSimulator(a.udid as string));
  handle("disconnect_simulator", "admin", (a) =>
    disconnectSimulator(a.udid as string),
  );
  handle("active_simulator", "admin", () => activeSimulator());
  toolHandle("start_simulator_capture", "admin", "device-recording", (a) =>
    startSimulatorCapture(a.udid as string),
  );
  toolHandle("stop_simulator_capture", "admin", "device-recording", (a) =>
    Promise.resolve(stopSimulatorCapture(a.udid as string)),
  );
  toolHandle("simulator_touch", "admin", "device-control", (a) =>
    simulatorTouch(
      a.udid as string,
      a.x as number,
      a.y as number,
      a.eventType as number,
    ),
  );
  toolHandle("simulator_device_state", "monitor", "device-control", (a) =>
    simulatorDeviceState(a.udid as string),
  );
  toolHandle("simulator_set_fold", "admin", "device-control", (a) =>
    simulatorSetFold(a.udid as string, a.pose as FoldPose),
  );
  toolHandle("simulator_set_orientation", "admin", "device-control", (a) =>
    simulatorSetOrientation(
      a.udid as string,
      a.orientation as DeviceOrientation,
    ),
  );
  toolHandle("simulator_button", "admin", "device-control", (a) =>
    simulatorButton(a.udid as string, a.button as string),
  );
  toolHandle("device_input_endpoint", "admin", "device-control", (a) =>
    getDeviceInputEndpoint(a.deviceKey as string),
  );
  toolHandle("device_open_link", "admin", "device-control", (a) =>
    openDeepLink(a.deviceKey as string, a.url as string),
  );
  toolHandle("simulator_keyboard", "admin", "device-control", (a) =>
    simulatorKeyboard(
      a.udid as string,
      a.keyCode as number,
      a.modifierFlags as number,
      a.isDown as boolean,
    ),
  );
  toolHandle("open_device_popout", "admin", "device-recording", async (a) => {
    const platform = a.platform as "android" | "ios" | "video";
    const deviceKey = a.deviceKey as string;

    let deviceName = (a.name as string | undefined) ?? "Device";
    let runtime = "";
    let online = platform === "video";
    // Acquire a capture reference so the stream survives the main window
    // switching away from this device. Only for a device that's actually up —
    // capturing a shut-down simulator hides the popout's own Boot button and
    // leaves the user with an empty frame and no way out.
    let capturing = false;

    if (platform === "ios") {
      const devices = await listSimulators().catch(() => []);
      const device = devices.find((d) => d.udid === deviceKey);
      const active = appState.simulators.get(deviceKey);
      deviceName = active?.deviceName ?? device?.name ?? deviceName;
      runtime = device?.runtime ?? "";
      online = device?.booted ?? false;
      if (online) {
        capturing = await startSimulatorCapture(deviceKey)
          .then(() => true)
          .catch(() => false);
      }
    } else if (platform === "android") {
      const devices = await listAndroidDevices().catch(() => []);
      const device = devices.find((d) => d.serial === deviceKey);
      deviceName = device?.name ?? deviceName;
      online = device?.online ?? false;
      if (online) {
        capturing = await startAndroidCapture(deviceKey)
          .then(() => true)
          .catch(() => false);
      }
    }

    createFloatingDeviceWindow({
      platform,
      deviceKey,
      deviceName,
      runtime,
      online,
      capturing,
    });
  });
  toolHandle("close_device_popout", "admin", "device-recording", (a) => {
    closeFloatingDeviceWindow(
      a.platform as "android" | "ios" | "video",
      a.deviceKey as string,
    );

    return Promise.resolve();
  });

  handle("open_agent_popout", "host", (a) => {
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
    emitHostEvent("agent:popout-opened", { agentId, sessionId });

    return Promise.resolve();
  });
  handle("close_agent_popout", "host", (a) => {
    const agentId = a.agentId as string;
    closeFloatingAgentWindow(agentId);
    // The window's `closed` handler broadcasts `agent:popout-closed`; nothing
    // more to do here.

    return Promise.resolve();
  });
  handle("list_popped_out_agents", "admin", () =>
    Promise.resolve(Array.from(agentPopouts.keys())),
  );

  handle("list_queued_messages", "admin", (a) =>
    Promise.resolve(listQueue(a.agentId as string)),
  );
  handle("queue_message", "admin", (a) =>
    Promise.resolve(
      enqueueMessage(a.agentId as string, {
        text: a.text as string,
        displayText: a.displayText as string | undefined,
        images: a.images as QueuedImage[] | undefined,
        author: a.author as string | undefined,
      }),
    ),
  );
  handle("remove_queued_message", "admin", (a) => {
    removeQueuedMessage(a.agentId as string, a.id as string);

    return Promise.resolve();
  });
  handle("update_queued_message", "admin", (a) => {
    updateQueuedMessage(a.agentId as string, a.id as string, a.text as string);

    return Promise.resolve();
  });
  handle("clear_queued_messages", "admin", (a) => {
    clearQueue(a.agentId as string);

    return Promise.resolve();
  });
  handle("dequeue_message", "admin", (a) =>
    Promise.resolve(dequeueMessage(a.agentId as string) ?? null),
  );

  handle("publish_agent_snapshot", "admin", (a) => {
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
  handle("get_agent_snapshot", "admin", (a) => {
    const agentId = a.agentId as string;

    return Promise.resolve(appState.agentSnapshots.get(agentId) ?? null);
  });
  handle("get_session", "admin", (a) => {
    const id = a.id as string;

    return Promise.resolve(appState.sessions.get(id) ?? null);
  });

  // Video-input viewer — ensure macOS camera (capture-card) access is granted.
  // Returns the resulting TCC status so the renderer can surface it.
  handle("request_camera_access", "admin", async () => {
    if (process.platform !== "darwin") {
      return "granted";
    }
    const status = systemPreferences.getMediaAccessStatus("camera");
    if (status === "granted") {
      return "granted";
    }
    // Only "not-determined" can prompt; "denied"/"restricted" must be changed
    // in System Settings and would otherwise hang here.
    if (status !== "not-determined") {
      return status;
    }
    const granted = await systemPreferences.askForMediaAccess("camera");

    return granted ? "granted" : "denied";
  });

  // Android device commands
  handle("check_android_tools", "admin", () => checkAndroidTools());
  handle("list_android_devices", "admin", () => listAndroidDevices());
  handle("list_avds", "admin", () => listAvds());
  handle("boot_android_emulator", "admin", (a) =>
    bootAndroidEmulator(a.avdName as string),
  );
  toolHandle("start_android_capture", "admin", "device-recording", (a) =>
    startAndroidCapture(a.serial as string),
  );
  toolHandle("stop_android_capture", "admin", "device-recording", (a) =>
    stopAndroidCapture(a.serial as string),
  );
  toolHandle("disconnect_android_device", "admin", "device-recording", (a) =>
    disconnectAndroidDevice(a.serial as string),
  );
  toolHandle("android_touch", "admin", "device-control", (a) =>
    androidTouch(
      a.serial as string,
      a.x as number,
      a.y as number,
      a.eventType as number,
    ),
  );
  toolHandle("android_keyboard", "admin", "device-control", (a) =>
    androidKeyboard(
      a.serial as string,
      a.keyCode as number,
      a.metaState as number,
      a.isDown as boolean,
    ),
  );
  toolHandle("android_button", "admin", "device-control", (a) =>
    androidButton(a.serial as string, a.button as string),
  );

  // Browser — Conductor-backed Chromium per session. Pool manages daemons;
  // screencast via raw CDP WebSocket; input forwarded through Conductor HTTP.
  handle("browser_view_ensure", "admin", async (a) => {
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
  handle("browser_view_navigate", "admin", async (a) => {
    const sessionId = a.sessionId as string;
    const reservation = webBrowserPool.getReservation(sessionId);
    if (!reservation) {
      return;
    }
    const nav = await conductorNavigate(reservation, a.url as string);
    emitNavState(sessionId, nav);
  });
  handle("browser_view_back", "admin", async (a) => {
    const sessionId = a.sessionId as string;
    const reservation = webBrowserPool.getReservation(sessionId);
    if (!reservation) {
      return;
    }
    const nav = await conductorGoBack(reservation);
    emitNavState(sessionId, nav);
  });
  handle("browser_view_forward", "admin", async (a) => {
    const sessionId = a.sessionId as string;
    const reservation = webBrowserPool.getReservation(sessionId);
    if (!reservation) {
      return;
    }
    const nav = await conductorGoForward(reservation);
    emitNavState(sessionId, nav);
  });
  handle("browser_view_reload", "admin", async (a) => {
    const sessionId = a.sessionId as string;
    const reservation = webBrowserPool.getReservation(sessionId);
    if (!reservation) {
      return;
    }
    const nav = await conductorReload(reservation);
    emitNavState(sessionId, nav);
  });
  handle("browser_view_destroy", "admin", async (a) => {
    const sessionId = a.sessionId as string;
    await stopScreencast(sessionId);
    appState.browserSessions.delete(sessionId);
    await webBrowserPool.releaseBrowser(sessionId);
  });
  toolHandle("browser_mouse_event", "admin", "device-control", async (a) => {
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
  toolHandle("browser_keyboard_event", "admin", "device-control", async (a) => {
    const reservation = webBrowserPool.getReservation(a.sessionId as string);
    if (reservation) {
      await conductorKeyboardEvent(
        reservation,
        a.type as "down" | "press" | "up",
        a.key as string,
      );
    }
  });
  toolHandle("browser_wheel_event", "admin", "device-control", async (a) => {
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
  handle("browser_update_preset", "admin", async (a) => {
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
  handle("browser_get_mjpeg_port", "admin", () => getMjpegPort());

  // Devices + conductor logs
  handle("list_devices", "admin", () => listDevices());
  handle("stop_device", "admin", (a) =>
    stopDevice(a.platform as DevicePlatform, a.deviceKey as string),
  );
  toolHandle("list_conductor_logs", "admin", "device-control", (a) =>
    conductorLogStore.list(a.deviceKey as string),
  );
  toolHandle("inspection_capture", "admin", "device-inspector", (a) =>
    captureUi({ deviceKey: a.deviceKey as string }),
  );
  toolHandle("inspection_probe", "admin", "device-inspector", (a) =>
    probeInjection(a.deviceKey as string),
  );
  toolHandle("inspection_list_apps", "admin", "device-inspector", (a) =>
    listInstalledApps(a.deviceKey as string),
  );
  toolHandle("inspection_launch_injected", "admin", "device-inspector", (a) =>
    launchInjected(a.deviceKey as string, a.bundleId as string),
  );
  toolHandle("inspection_set_property", "admin", "device-inspector", (a) =>
    setNodeProperty({
      deviceKey: a.deviceKey as string,
      nodeId: a.nodeId as string,
      key: a.key as string,
      value: a.value as string,
    }),
  );
  toolHandle("inspection_node_props", "admin", "device-inspector", (a) =>
    getNodeProps(a.deviceKey as string, a.nodeId as string),
  );
  toolHandle("run_conductor_command", "admin", "device-control", async (a) => {
    const deviceKey = a.deviceKey as string;
    const args = a.args as string[];
    const hasDeviceFlag = args.some((x) => x === "--device" || x === "-d");
    const finalArgs = hasDeviceFlag ? args : [...args, "--device", deviceKey];
    await execConductor(deviceKey, finalArgs);
  });

  // Debug panel — streaming conductor subprocesses + one-shot probes.
  toolHandle("debug_start_stream", "admin", "device-debug", (a) => {
    startDebugStream({
      streamId: a.streamId as string,
      deviceKey: a.deviceKey as string,
      args: a.args as string[],
    });

    return null;
  });
  toolHandle("debug_stop_stream", "admin", "device-debug", (a) => {
    stopDebugStream(a.streamId as string);

    return null;
  });
  toolHandle("debug_list_streams", "admin", "device-debug", () =>
    listDebugStreams(),
  );
  toolHandle("debug_run_command", "admin", "device-debug", (a) =>
    runDebugCommand(a.deviceKey as string, a.args as string[]),
  );

  // The renderer decides *what* a notification says (it holds the session and
  // conversation state); the main process shows it, because only there can
  // Electron render quick-action buttons, and fans it out to remote devices.
  handle("notify_agent", "admin", (a) => {
    showAgentNotification(a.payload as AgentNotificationInput, {
      showLocal: a.showLocal as boolean,
    });
  });

  // Shell
  handle("reveal_in_finder", "host", (a) => revealInFinder(a.path as string));
  handle("open_path", "host", (a) => openPath(a.path as string));
  handle("open_external_url", "host", (a) => openExternalUrl(a.url as string));
  handle("list_editors", "admin", () => listEditors());
  handle("open_in_editor", "host", (a) =>
    openInEditor(a.editorId as string, a.path as string),
  );
  handle("open_in_custom_editor", "host", (a) =>
    openInCustomEditor(a.command as string, a.path as string),
  );

  // Tools — backend mirror of the renderer's enable map.
  handle("get_enabled_tools", "admin", () => getEnabledToolsForRenderer());
  handle("set_enabled_tools", "admin", (a) => {
    setEnabledToolsFromRenderer(
      (a.userEnabled ?? {}) as Partial<Record<string, boolean>>,
    );
  });
  handle("get_conductor_status", "admin", () => getConductorStatus());
  handle("list_conductor_versions", "admin", () =>
    listConductorVersions(readBundledVersion()),
  );
  handle("set_conductor_version", "admin", (a) =>
    setConductorOverrideVersion((a.version ?? null) as string | null),
  );
  // Image context menu
  handle("show_image_context_menu", "host", async (a) => {
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
  handle("show_open_dialog", "host", async (a) => {
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
  handle("onboarding_get_state", "admin", () => getOnboardingState());
  handle("onboarding_ensure_argus_dir", "admin", () => ({
    path: onboardingEnsureDir(),
  }));
  handle("onboarding_set_last_step", "admin", (a) => {
    setLastStep(a.step as OnboardingStep);
  });
  handle("onboarding_add_skipped", "admin", (a) => {
    onboardingAddSkipped(a.id as string);
  });
  handle("onboarding_check_prereqs", "admin", async (a) => {
    const ids = a.ids as PrereqId[] | undefined;

    return runPrereqChecks((update: PrereqResult) => {
      getMainWindow()?.webContents.send("onboarding:prereq_update", update);
    }, ids);
  });
  handle("onboarding_run_fixer", "admin", (a) =>
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
  handle("onboarding_claude_ping", "admin", () => onboardingClaudePing());
  handle("claude_auth_status", "admin", (a) =>
    getClaudeAuthStatus(a.accountId as string | undefined),
  );
  handle("claude_auth_logout", "admin", (a) =>
    claudeLogout(a.accountId as string | undefined),
  );
  handle("claude_auth_login_start", "admin", (a) =>
    claudeLoginStart({
      useConsole: a.useConsole as boolean | undefined,
      accountId: a.accountId as string | undefined,
    }),
  );
  handle("claude_accounts_list", "admin", () => ({
    accounts: listClaudeAccounts(),
    activeId: getActiveAccountId(),
  }));
  handle("claude_accounts_set_active", "admin", (a) => {
    setActiveAccount(a.id as string);
    emitAccountsChanged();

    return null;
  });
  handle("claude_accounts_add", "admin", (a) =>
    claudeAddAccount({ useConsole: a.useConsole as boolean | undefined }),
  );
  handle("claude_accounts_remove", "admin", async (a) => {
    await removeClaudeAccount(a.id as string);
    emitAccountsChanged();

    return null;
  });
  handle("claude_accounts_rename", "admin", (a) => {
    renameClaudeAccount(a.id as string, a.label as string);
    emitAccountsChanged();

    return null;
  });
  handle("claude_accounts_refresh", "admin", async (a) => {
    await claudeRefreshAccount(a.id as string);

    return null;
  });
  handle("claude_auth_login_submit_code", "admin", (a) =>
    claudeLoginSubmitCode({ code: a.code as string }),
  );
  handle("claude_auth_login_cancel", "admin", () => {
    claudeLoginCancel();

    return null;
  });
  handle("onboarding_list_examples", "admin", () => onboardingListExamples());
  handle("onboarding_clone_example", "admin", (a) =>
    onboardingCloneExample(a.slug as string),
  );
  handle("onboarding_register_project", "admin", (a) => {
    onboardingRegisterProject(a.path as string);
  });
  handle("onboarding_suggest_argus_json", "admin", (a) =>
    onboardingSuggestArgusJson(a.path as string),
  );
  handle("onboarding_read_existing_argus_json", "admin", (a) =>
    readExistingArgusJson(a.path as string),
  );
  handle("onboarding_refine_argus_json_with_claude", "admin", (a) =>
    refineArgusJsonWithClaude(
      a.path as string,
      a.config as Record<string, unknown>,
    ),
  );
  handle("onboarding_write_argus_json", "admin", (a) => {
    onboardingWriteArgusJson(
      a.path as string,
      a.config as Record<string, unknown>,
    );
  });
  handle("onboarding_complete", "admin", () => {
    onboardingComplete();
  });
  handle("onboarding_reset", "admin", () => {
    resetOnboarding();
  });
  handle("onboarding_argus_dir_path", "admin", () => argusDirPath());

  handle("llm_list_runners", "admin", () =>
    listLlmRunners().map((r) => ({
      id: r.id,
      displayName: r.displayName,
      capabilities: r.capabilities(),
      isCustom: r.isCustom ?? false,
      baseRunnerId: r.baseRunnerId ?? null,
      models: r.models?.() ?? [],
      defaultModel: r.defaultModel?.() ?? null,
    })),
  );

  // Custom runners — official runners re-pointed at another endpoint. Every
  // mutation re-syncs the registry so the picker and resolver see the change
  // without an app restart.
  // Re-binding a session to another runner. Only legal while the session has
  // no conversation yet — the handler enforces it.
  handle("set_session_runner", "admin", (a) =>
    setSessionRunner(a.sessionId as string, a.runnerId as string).then(
      () => null,
    ),
  );
  handle("llm_list_custom_runners", "admin", () => listCustomRunners());
  handle(
    "llm_list_custom_runner_presets",
    "admin",
    () => CUSTOM_RUNNER_PRESETS,
  );
  handle("llm_save_custom_runner", "admin", (a) => {
    const saved = saveCustomRunner(a.runner as Partial<CustomRunner>);
    syncCustomRunners();

    return saved;
  });
  handle("llm_delete_custom_runner", "admin", (a) => {
    deleteCustomRunner(a.id as string);
    syncCustomRunners();
  });

  // Telemetry — anonymous PostHog. Renderer asks for the install id + current
  // enable state at boot, and pushes opt-in/opt-out toggles back here.
  handle("get_app_version", "admin", () => app.getVersion());
  handle("telemetry_get_init", "admin", () => ({
    distinctId: getAnonymousId(),
    mode: getTelemetryMode(),
    configured: isTelemetryConfigured(),
    appVersion: app.getVersion(),
  }));
  handle("telemetry_set_mode", "admin", (a) => {
    const next = a.mode;
    if (next === "presence" || next === "full") {
      setTelemetryMode(next);
    }
  });
  handle("telemetry_capture", "admin", (a) => {
    // The renderer is responsible for matching the event catalog (typed on
    // its side via app/lib/telemetryEvents.ts). At the IPC boundary it
    // arrives as opaque strings; we trust the renderer's type-checked call
    // sites and forward as-is.
    telemetryCapture(
      String(a.event) as Parameters<typeof telemetryCapture>[0],
      (a.props ?? {}) as never,
    );
  });
  handle("telemetry_capture_exception", "admin", (a) => {
    const message = String(a.message ?? "renderer error");
    const stack = typeof a.stack === "string" ? a.stack : undefined;
    const err = new Error(message);
    if (stack) {
      err.stack = stack;
    }
    telemetryCaptureException(err, (a.props as Record<string, unknown>) ?? {});
  });
  handle("telemetry_capture_feedback", "admin", (a) => {
    telemetryCaptureFeedback(String(a.message ?? ""));
  });

  // Phase 10 — auto-fetch reconfiguration. Called by the UI after the user
  // changes `auto_fetch_minutes` in `.argus.json` via Project Settings.
  handle("git_reconfigure_auto_fetch", "admin", (a) => {
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
  handle("git_compare_branches", "admin", (a) =>
    gitCompareBranches(a.sessionId as string, {
      left: a.left as string,
      right: a.right as string,
    }),
  );
}
