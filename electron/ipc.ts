/**
 * IPC command registration — routes commands to service functions.
 *
 * Every command is declared through `defineCommand` (via the local `handle`
 * helpers), which owns the registry entry; `ipcBridge.ts` publishes it on IPC.
 * Each handler unwraps the args object and delegates to the appropriate service.
 * Errors thrown in handlers automatically reject the renderer's promise
 * (errors are thrown as plain strings).
 */

import type {
  CreateAutomationInput,
  SaveMemoryInput,
  StartScratchRunInput,
  UpdateAutomationInput,
} from "@argus/host/services/automation/models";
import type { ProposalStatus } from "@argus/host/services/automation/proposals/models";
import type { CommandTier } from "@argus/host/services/command/registry";
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
import { stopAgent } from "@argus/host/services/agent/claude";
import {
  draftAutomation,
  revisePlaybook,
} from "@argus/host/services/automation/authoring";
import { submitRunFeedback } from "@argus/host/services/automation/feedback";
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
import {
  deleteAutomationMemory,
  listAutomationMemories,
  saveAutomationMemory,
} from "@argus/host/services/automation/memory/service";
import { calibrationFor } from "@argus/host/services/automation/outcomes";
import { acceptProposal } from "@argus/host/services/automation/proposals/accept";
import { performProposalCleanup } from "@argus/host/services/automation/proposals/cleanup";
import {
  dismissProposal,
  getProposal,
  listProposals,
  resolveProposal,
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
import { testMcpServer } from "@argus/host/services/mcp/connectivity";
import {
  authenticate,
  cancelAuthentication,
  signOut,
} from "@argus/host/services/mcp/oauth";
import { listAuthorized, loadToken } from "@argus/host/services/mcp/oauthStore";
import { listInheritedMcpServers } from "@argus/host/services/mcp/userConfig";
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
import { autofillPullRequestBody } from "@argus/host/services/session/prAutofill";
import { readPullRequestTemplate } from "@argus/host/services/session/pullRequest";
import { openExternalUrl } from "@argus/host/services/shell/operations";
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
import { toolEnabled } from "@argus/host/services/tools/state";
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
import { publishActivity } from "./services/continuity";
import {
  checkForUpdates as updaterCheck,
  downloadUpdate as updaterDownload,
  getUpdaterState,
  quitAndInstallUpdate,
} from "./services/updater";

type Args = Record<string, unknown>;

function emitNavState(sessionId: string, nav: NavState): void {
  emitHostEvent("browser_view:nav", {
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
  // Picks the run's own agent back up rather than firing the automation again.
  handle("automation_run_feedback", "admin", (a) =>
    submitRunFeedback({
      runId: a.runId as string,
      note: a.note as string,
      allowClearing: a.allowClearing as boolean | undefined,
    }),
  );
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
  // Same rule as drafting: the rewrite comes back as text for the editor, and
  // only a save puts it anywhere near a scheduled run.
  handle("automation_playbook_revise", "admin", (a) =>
    revisePlaybook({
      playbook: a.playbook as string,
      instruction: a.instruction as string,
      name: a.name as string | undefined,
    }),
  );
  handle("automation_memories_list", "admin", (a) =>
    listAutomationMemories(a.automationId as string),
  );
  handle("automation_memory_save", "admin", (a) =>
    saveAutomationMemory(a.automationId as string, a.input as SaveMemoryInput),
  );
  handle("automation_memory_delete", "admin", (a) => {
    deleteAutomationMemory(a.automationId as string, a.name as string);
  });
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
  handle("proposal_resolve", "admin", (a) =>
    resolveProposal(a.id as string, a.note as string | undefined),
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
  // Handoff — the renderer owns "what am I looking at", the main process owns
  // the NSUserActivity that advertises it to the phone.
  handle("publish_handoff", "host", (a) => {
    const sessionId = a.sessionId as string | null;

    return publishActivity(
      sessionId
        ? {
            sessionId,
            agentId: a.agentId as string | undefined,
            label: a.label as string | undefined,
            projectName: a.projectName as string | undefined,
            repoRoot: a.repoRoot as string | undefined,
          }
        : null,
    );
  });

  handle("list_popped_out_agents", "admin", () =>
    Promise.resolve(Array.from(agentPopouts.keys())),
  );

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
    emitHostEvent("browser:ensure_mounted", { sessionId });
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

}
