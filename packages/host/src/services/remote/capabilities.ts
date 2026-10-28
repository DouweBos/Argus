/**
 * The hard capability allowlist: the ONLY methods a remote device can invoke.
 *
 * A method is reachable iff it has an entry here. There is deliberately no
 * handler for spawn/send/terminal/write — those service functions are simply
 * unreachable from the remote surface, regardless of payload. Widening the
 * surface (e.g. adding "full control") means adding an entry here plus a new
 * capability grant — an explicit, reviewable change, never an accidental unlock.
 */

import type { AgentSession } from "../agent/models";
import type { InitializeResponse } from "../llm/runners/claudeCode/protocol";
import type { Session } from "../session/models";
import type { SimulatorDeviceState } from "../simulator/deviceState";
import {
  browserClaimId,
  isAgentInScope,
  isBrowserInScope,
  isDeviceInScope,
  METHOD_SCOPE,
  MethodParams,
  REMOTE_METHODS,
  UNKNOWN_COMMAND,
  type Capability,
  type GrantScope,
  type ImageAttachment,
  type RemoteAgentCapabilities,
  type RemoteAgentStatus,
  type RemoteClaudeAccount,
  type RemoteGitStatus,
  type RemoteDevice,
  type RemoteDeviceState,
  type RemoteGitBranch,
  type RemoteMethod,
  type RemotePlatform,
  type RemoteSession,
  type RemoteStoppedAgent,
} from "@argus/remote-protocol";
import type { z } from "zod";
import { emitHostEvent } from "@argus/host/bus";
import { error as logError, info as logInfo } from "@argus/host/logger";
import { appState } from "../../state";
import { applyPushedEntries } from "../account/lifecycle";
import { remoteAccountStatus, requestLinkFromPaired } from "../account/service";
import {
  interruptAgent,
  respondToPermission,
  sendAgentMessage,
  setAgentEffort,
  setAgentModel,
  setAgentPermissionMode,
  startAgent,
  stopAgent,
  switchSessionClaudeAccount,
} from "../agent/agentService";
import { loadConversation, loadHistoryIndex } from "../agent/chatHistory";
import { agentContextWindow } from "../agent/contextWindow";
import { liveCursor, readConversation } from "../agent/conversation/live";
import { dismissLimitResume, limitResumeAt } from "../agent/limitResume";
import {
  enqueueMessage,
  listQueue,
  removeQueuedMessage,
  updateQueuedMessage,
} from "../agent/messageQueue";
import { saveAppSettings } from "../appSettings/store";
import { revisePlaybook } from "../automation/authoring";
import { appDefaultAutonomy } from "../automation/autonomy";
import {
  deleteRun,
  getAutomation,
  getAutomationRun,
} from "../automation/manager";
import {
  deleteAutomationMemory,
  listAutomationMemories,
  saveAutomationMemory,
} from "../automation/memory/service";
import { calibrationFor } from "../automation/outcomes";
import { cancelAutomationRun } from "../automation/runner";
import { startAutomationRun } from "../automation/runner";
import {
  getActiveAccountId,
  refreshAllAccountIdentities,
  removeClaudeAccount,
  renameClaudeAccount,
  setActiveAccount,
} from "../claudeAuth/accounts";
import {
  claudeAddAccount,
  claudeLoginCancel,
  claudeLoginStart,
  claudeLoginSubmitCode,
  emitAccountsChanged,
  getClaudeLoginState,
} from "../claudeAuth/claudeAuth";
import { recheckFlaggedAccounts } from "../claudeAuth/probe";
import { getClaudeUsageLimits } from "../claudeUsage/limits";
import { getClaudeUsageSummary } from "../claudeUsage/summary";
import {
  CommandParamsError,
  getCommand,
  invokeCommand,
} from "../command/registry";
import { compareToDesign } from "../design/compare";
import {
  isEasDeviceId,
  remoteEasDeviceHosts,
  runningEasDevice,
  startEasSession,
  stopEasSession,
} from "../deviceHosts/eas/registry";
import { listDeviceHosts } from "../deviceHosts/registry";
import { listSessionFiles, resolveMentionPath } from "../file/operations";
import { figmaFrameDetails } from "../integrations/figma/service";
import { prepareIssueStart } from "../integrations/issueStart";
import {
  commentOnLinearIssueById,
  getLinearIssue,
  linearTeamStates,
  listIntegrations,
  listLinearIssues,
  updateLinearIssue,
} from "../integrations/service";
import { getRunnerById } from "../llm/registry";
import { collectAllProjects } from "../mcp/projectDiscovery";
import { createScratchPad, listScratchPads } from "../scratchPad/manager";
import {
  gitCheckout,
  gitCreateBranch,
  gitDeleteBranch,
  gitDiscardAndCheckout,
  gitListLocalBranches,
  gitListRemoteBranches,
  gitStashAndCheckout,
} from "../session/gitBranchOps";
import { GitError, serializeGitError } from "../session/gitError";
import { gitStatus } from "../session/gitStatus";
import { gitListTags } from "../session/gitTags";
import {
  clearSessionSetupError,
  createSession,
  deleteSession,
  listSessions,
  renameSession,
  renameSessionBranch,
  retrySessionSetup,
} from "../session/manager";
import { getSessionProgress } from "../session/progress";
import {
  getSessionBranchDiff,
  getSessionFullDiff,
  getSessionMergeBlockers,
  gitCommit,
  gitStashApply,
  gitStashDrop,
  gitStashList,
  mergeSessionIntoBase,
  pushSessionBranch,
  setSessionBaseBranch,
  stageAll,
} from "../session/sessionOps";
import { waitForSessionReady } from "../session/waitForReady";
import { computeSessionDiffStats } from "../session/watcher";
import {
  androidButton,
  androidKeyboard,
  androidTouch,
  isAndroidCapturing,
  listAndroidDevices,
} from "../simulator/android";
import {
  isSimulatorCapturing,
  listAllSimulators,
  simulatorButton,
  simulatorDeviceState,
  simulatorKeyboard,
  simulatorSetFold,
  simulatorSetOrientation,
  simulatorTouch,
} from "../simulator/ios";
import { devicePng } from "../simulator/screenshot";
import { getVideoDims } from "../simulator/videoForward";
import { capture } from "../telemetry/telemetry";
import {
  listTerminals,
  readTerminalOutput,
  terminalScrollback,
} from "../terminal/multiplexer";
import { listPinnedBranches } from "../userProjectSettings/store";
import {
  createRemoteAutomation,
  deleteRemoteAutomation,
  markRemoteRunRead,
  submitRemoteRunFeedback,
  remoteAutomation,
  remoteAutomationDraft,
  remoteAutomationRun,
  remoteAutomationRuns,
  remoteAutomations,
  remoteRunners,
  remoteSignalSources,
  saveRemoteScratchRun,
  startRemoteScratchRun,
  setRemoteAutomationEnabled,
  toRemoteAutomationRun,
  updateRemoteAutomation,
} from "./automationsRemote";
import {
  claimDevice,
  claimState,
  getClaim,
  releaseDevice,
  type ClaimHolder,
} from "./deviceClaims";
import {
  clearDevicePush,
  renameDevice,
  setDevicePush,
  type PairedDevice,
} from "./deviceStore";
import { getEndpoints } from "./endpoints";
import {
  cancelSessionSearch,
  readSessionFile,
  searchSessionFiles,
} from "./filesRemote";
import {
  branchLog,
  branchPrUrl,
  commitDiff,
  compareBranches,
  mergeIntoCurrent,
  pullCurrent,
  pushBranch,
  rebaseCurrent,
  renameLocalBranch,
  setBranchPinned,
} from "./gitRemote";
import {
  commentOnRemotePullRequest,
  createRemotePullRequest,
  mergeRemotePullRequest,
  remotePullRequest,
  remotePullRequests,
} from "./githubRemote";
import { hostLabelForAgent } from "./huddle";
import {
  acceptRemoteProposal,
  dismissRemoteProposal,
  performRemoteProposalCleanup,
  remoteProposal,
  remoteProposals,
  requestRemoteProposalRevision,
  resolveRemoteProposal,
} from "./proposalsRemote";
import {
  ensureVapidPublicKey,
  getPushConfigStatus,
  isPushConfigured,
} from "./push/config";
import { ShareError } from "./shareError";
import {
  findImage,
  type RawConversation,
  type RawMessage,
  toRemoteTasks,
  toRemoteTodos,
  transcriptPage,
} from "./transcript";

export class GatewayError extends Error {
  constructor(
    readonly code:
      | "bad_request"
      | "capability_denied"
      | "internal"
      | "not_found",
    message: string,
    /** Structured payload the client rehydrates (e.g. a serialised GitError). */
    readonly data?: unknown,
  ) {
    super(message);
    this.name = "GatewayError";
  }
}

/**
 * No such method or command on this host — usually a client newer than it.
 * Keeps the old code and text for older clients; `data` is for newer ones.
 */
export function unknownMethodError(
  code: "capability_denied" | "not_found",
  method: string,
  noun: "command" | "method" = "method",
): GatewayError {
  return new GatewayError(code, `unknown ${noun} ${method}`, {
    reason: UNKNOWN_COMMAND,
    method,
  });
}

/**
 * Screen-stream control for a connection. Implemented by `DeviceConnection`,
 * which owns the binary media channel; kept as an interface so `capabilities`
 * stays free of transport concerns.
 */
export interface DeviceMediaController {
  /** Start streaming a device's screen; returns the binary-frame stream id. */
  watch: (deviceId: string, platform: RemotePlatform) => Promise<number>;
  unwatch: (deviceId: string) => void;
  /** Same, for an embedded browser session's JPEG frames. */
  watchBrowser: (sessionId: string) => number;
  unwatchBrowser: (sessionId: string) => void;
}

/** Per-connection context handed to each handler. */
export interface GatewayContext {
  device: PairedDevice;
  /** Identifies this connection, not the device — a reconnect is a new id. */
  connectionId: string;
  /** `agentId::toolUseId` prompts this device was forwarded and may answer. */
  outstandingPermissions: Set<string>;
  /** Screen-stream control, present when the transport carries a media channel. */
  media?: DeviceMediaController;
  /**
   * Narrows this connection to specific agents and devices (a huddle guest).
   * Absent — the case for every paired device — means no narrowing at all.
   */
  scope?: GrantScope;
  /**
   * The local UI socket: the app on this machine, authenticated by owning the
   * socket file. The only caller allowed `host`-tier commands.
   */
  console?: boolean;
}

export function permissionKey(agentId: string, toolUseId: string): string {
  return `${agentId}::${toolUseId}`;
}

function claimHolder(ctx: GatewayContext): ClaimHolder {
  return {
    connectionId: ctx.connectionId,
    deviceId: ctx.device.device_id,
    label: ctx.device.label,
  };
}

/**
 * Take the interaction claim on behalf of this connection, or refuse the input.
 * Watching stays unclaimed — only HID injection arbitrates.
 *
 * The refusal carries the claim state verbatim, so a client that raced the
 * `device.claim` event can show "controlled by …" from the error alone. Both
 * the typed `devices.*` handlers and the raw admin passthrough come through
 * here, which is what keeps a desktop and a phone agreeing on who is driving.
 */
function requireDeviceInput(deviceId: string, ctx: GatewayContext): void {
  const result = claimDevice(deviceId, claimHolder(ctx));
  if (!result.granted) {
    throw new GatewayError(
      "capability_denied",
      `device is being controlled by ${result.holder?.label ?? "another client"}`,
      claimState(deviceId),
    );
  }
}

/**
 * Map the host's simulator state onto the wire shape. Only iOS reports one —
 * Android emulators have no hinge and rotate the framebuffer themselves, so
 * there is nothing for a client to correct for.
 */
export function toRemoteDeviceState(
  state: SimulatorDeviceState,
): RemoteDeviceState {
  return {
    device_id: state.udid,
    fold: state.fold,
    orientation: state.orientation,
    display: state.display
      ? {
          width: state.display.width,
          height: state.display.height,
          rotation: state.display.rotation,
          screen_id: state.display.screenID,
        }
      : null,
  };
}

/** Map a booted iOS simulator to the remote device shape. */
function iosToRemoteDevice(d: {
  udid: string;
  name: string;
  runtime: string;
  booted: boolean;
  deviceHostLabel?: string;
}): RemoteDevice {
  const dims = getVideoDims(d.udid);

  return {
    id: d.udid,
    platform: "ios",
    name: d.name,
    runtime: d.runtime,
    booted: d.booted,
    is_tv: d.runtime.toLowerCase().includes("tvos"),
    capturing: isSimulatorCapturing(d.udid),
    width: dims?.width,
    height: dims?.height,
    ...(d.deviceHostLabel ? { device_host_label: d.deviceHostLabel } : {}),
  };
}

/** Map an online Android device/emulator to the remote device shape. */
function androidToRemoteDevice(d: {
  serial: string;
  name: string;
  online: boolean;
  isTv: boolean;
}): RemoteDevice {
  const dims = getVideoDims(d.serial);

  return {
    id: d.serial,
    platform: "android",
    name: d.name,
    booted: d.online,
    is_tv: d.isTv,
    capturing: isAndroidCapturing(d.serial),
    width: dims?.width,
    height: dims?.height,
  };
}

// --- Mappers (desktop model → monitor-scoped remote model) -----------------

/**
 * Start an agent in a session that was just created and hand it `prompt`
 * once setup finishes. Runs on the host so the client that asked can go away
 * — a backgrounded phone or a reloaded window must not strand the prompt.
 */
export async function startAgentWhenReady(
  sessionId: string,
  prompt: string,
  options: {
    model?: string;
    permissionMode?: string;
    runnerId?: string;
    images?: ImageAttachment[];
  } = {},
): Promise<void> {
  try {
    await waitForSessionReady(sessionId);
    const agent = await startAgent(
      sessionId,
      options.model,
      options.permissionMode,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      options.runnerId,
    );
    // Backend-initiated spawns are invisible to the UI without this.
    emitHostEvent("agent:started", {
      agent_id: agent.agent_id,
      session_id: agent.session_id,
      status: agent.status,
      parent_agent_id: agent.parent_agent_id,
      created_at: agent.created_at,
      initial_prompt: prompt,
      model: agent.model,
    });
    if (options.images?.length) {
      sendAgentMessage(agent.agent_id, prompt, options.images);
    } else {
      sendAgentMessage(agent.agent_id, prompt);
    }
    // The renderer only draws user bubbles for sends it made itself.
    emitHostEvent(`agent:remote-message:${agent.agent_id}`, {
      message: prompt,
      author: null,
    });
    logInfo(`Started agent ${agent.agent_id} with its prompt in ${sessionId}`);
    capture("session_prompt_dispatched", { success: true });
  } catch (e) {
    logError(`Couldn't start the prompted agent in ${sessionId}: ${String(e)}`);
    capture("session_prompt_dispatched", { success: false });
  }
}

function sessionStatus(status: Session["status"]): RemoteSession["status"] {
  return typeof status === "string" ? status : "error";
}

function toRemoteSession(s: Session): RemoteSession {
  return {
    id: s.id,
    repo_root: s.repo_root,
    kind: s.kind,
    branch: s.branch,
    display_name: s.display_name ?? null,
    base_branch: s.base_branch ?? null,
    claude_account_id: s.claude_account_id ?? null,
    status: sessionStatus(s.status),
    setup_error:
      typeof s.status === "object" && "error" in s.status
        ? s.status.error
        : null,
    progress:
      s.status === "initializing" || s.status === "deleting"
        ? getSessionProgress(s.id)
        : null,
    availability: s.availability ?? "available",
    // The drive's name, not its mount point — this schema keeps host paths
    // off the wire, and the name is what the user has to go and plug in.
    unavailable_volume: s.unavailable_volume
      ? (s.unavailable_volume.split("/").pop() ?? null)
      : null,
    volume: s.volume ? (s.volume.split("/").pop() ?? null) : null,
    linked_issue: s.linked_issue ?? null,
    design_refs: s.design_refs ?? null,
  };
}

function sessionLabel(sessionId: string): string {
  const s = appState.sessions.get(sessionId);
  if (!s) {
    return "unknown session";
  }
  if (s.kind === "project_root") {
    return "Project root";
  }

  return s.display_name ?? s.branch;
}

/** Repository the session lives in, named the way `projects.list` names it. */
function sessionProjectName(sessionId: string): string | undefined {
  const session = appState.sessions.get(sessionId);
  // A scratch pad's directory is not a project; its name is the session label.
  if (session?.kind === "scratch_pad") {
    return undefined;
  }
  const repoRoot = session?.repo_root;

  return repoRoot ? (repoRoot.split("/").pop() ?? repoRoot) : undefined;
}

/** The agent's generated conversation title. */
function agentTitle(agentId: string): string | null {
  try {
    const title = readConversation(agentId)?.title;

    return title && title.trim() ? title : null;
  } catch {
    return null;
  }
}

/**
 * What an agent is blocked on the user for. Permission prompts are tracked
 * host-side; questions and plan approvals never raise one in auto-approving
 * modes, so those come from the unresolved tool call in the transcript.
 */
function agentAwaiting(agentId: string): RemoteAgentStatus["awaiting"] {
  const pending = appState.agentPendingPermissions.get(agentId);
  const prompt = pending ? [...pending.values()][0] : undefined;
  if (prompt) {
    return awaitingForTool(prompt.tool_name) ?? "permission";
  }

  try {
    const conv = readConversation(agentId) as RawConversation | null;
    for (const message of (conv?.messages ?? []).slice(-3).reverse()) {
      for (const tc of message.toolCalls ?? []) {
        if (tc.result != null) {
          continue;
        }
        if (tc.pendingPermission) {
          return awaitingForTool(tc.name) ?? "permission";
        }
        const awaiting = awaitingForTool(tc.name);
        if (awaiting) {
          return awaiting;
        }
      }
    }
  } catch {
    // A malformed conversation — treat as nothing pending.
  }

  return null;
}

function awaitingForTool(name: string | undefined): "plan" | "question" | null {
  if (name === "AskUserQuestion") {
    return "question";
  }

  return name === "ExitPlanMode" ? "plan" : null;
}

export function toRemoteAgentStatus(a: AgentSession): RemoteAgentStatus {
  return {
    agent_id: a.agentId,
    session_id: a.sessionId,
    session_label: sessionLabel(a.sessionId),
    project_name: sessionProjectName(a.sessionId),
    title: agentTitle(a.agentId),
    status: a.status,
    model: a.model,
    context_window: agentContextWindow(a),
    permission_mode: a.permissionMode ?? null,
    parent_agent_id: a.parentAgentId,
    created_at: a.createdAt,
    last_activity_at: a.lastEventAt,
    awaiting: agentAwaiting(a.agentId),
    limit_resume_at: limitResumeAt(a.agentId),
  };
}

/** Narrow a runner's initialize response to the input pickers' shape. */
export function toRemoteAgentCapabilities(
  init: InitializeResponse,
): RemoteAgentCapabilities {
  return {
    models: init.models.map((m) => ({
      value: m.value,
      displayName: m.displayName,
      description: m.description,
      supportsEffort: m.supportsEffort,
      supportedEffortLevels: m.supportedEffortLevels,
      supportsFastMode: m.supportsFastMode,
    })),
    commands: init.commands.map((c) => ({
      name: c.name,
      description: c.description,
      argumentHint: c.argumentHint,
    })),
    agents: init.agents.map((a) => ({
      name: a.name,
      description: a.description,
      model: a.model,
    })),
  };
}

/** An agent's conversation, or throw a gateway error. */
function liveTranscript(agentId: string): RawConversation {
  const conv = readConversation(agentId) as RawConversation | null;
  if (!conv) {
    throw new GatewayError("not_found", `no transcript for ${agentId}`);
  }

  return conv;
}

/**
 * Read a stopped agent's conversation back off disk. Its live one is gone
 * the moment the agent is torn down, so saved chat history is the only record.
 */
function loadStoppedConversation(
  repoRoot: string,
  historyId: string,
): RawConversation {
  const saved = loadConversation(repoRoot, historyId);
  if (!saved) {
    throw new GatewayError("not_found", `no stopped agent ${historyId}`);
  }

  return {
    messages: saved.messages as RawMessage[],
    model: saved.model ?? null,
    title: saved.title,
  };
}

// --- Handlers --------------------------------------------------------------

type Handler = (params: unknown, ctx: GatewayContext) => Promise<unknown>;

type ParamsOf<M extends RemoteMethod> = z.infer<(typeof MethodParams)[M]>;

function parse<M extends RemoteMethod>(
  method: M,
  params: unknown,
): ParamsOf<M> {
  const schema = MethodParams[method] as unknown as z.ZodType<ParamsOf<M>>;
  const result = schema.safeParse(params);
  if (!result.success) {
    throw new GatewayError("bad_request", `invalid params for ${method}`);
  }

  return result.data;
}

/** Git refuses to delete a branch whose commits live nowhere else. */
function isUnmergedBranch(err: unknown): boolean {
  const text =
    err instanceof Error
      ? `${err.message} ${err instanceof GitError ? (err.stderr ?? "") : ""}`
      : String(err);

  return /not fully merged/i.test(text);
}

/**
 * Who to credit a message to, or undefined to leave it bare.
 *
 * A shared transcript has to say whose message each one is: several people are
 * writing into it, so unattributed means "could be anyone". Outside a huddle
 * there is only the engineer, and labelling every message would be noise.
 */
function messageAuthor(
  agentId: string,
  ctx: GatewayContext,
): string | undefined {
  // A scoped connection is a guest, and they answer to their own name.
  if (ctx.scope) {
    return ctx.device.label || undefined;
  }

  // Otherwise it is the engineer, reaching in from one of their own devices.
  return hostLabelForAgent(agentId);
}

/** Look up a live agent or throw a gateway not_found. */
function requireAgent(agentId: string): AgentSession {
  const agent = appState.agents.get(agentId);
  if (!agent) {
    throw new GatewayError("not_found", `no agent ${agentId}`);
  }

  return agent;
}

/** Ensure a session exists or throw a gateway not_found. */
/** How much of a terminal a phone reads: enough to follow a dev server. */
const TERMINAL_READ_TAIL = 64 * 1024;

function requireSession(id: string): void {
  if (!appState.sessions.has(id)) {
    throw new GatewayError("not_found", `no session ${id}`);
  }
}

/**
 * Reject a client-supplied repo root that isn't a registered project, so a
 * remote can't point session listing/creation at an arbitrary repo on disk
 * (whose `.argus.json` setup pipeline would otherwise run on create).
 */
function requireKnownRepoRoot(repoRoot: string): void {
  if (!collectAllProjects().some((p) => p.path === repoRoot)) {
    throw new GatewayError("not_found", `unknown repo_root`);
  }
}

/**
 * A saved chat's folder: a project, or a scratch pad's or automation run's own
 * folder, which no project lists but whose agents save history all the same.
 */
function requireKnownHistoryRoot(repoRoot: string): void {
  const ownFolder = [...appState.sessions.values()].some(
    (s) =>
      (s.kind === "scratch_pad" || s.kind === "automation_host") &&
      s.repo_root === repoRoot,
  );
  if (!ownFolder) {
    requireKnownRepoRoot(repoRoot);
  }
}

/**
 * Belt-and-braces rejection of "trusted" (bypassPermissions). The wire schema
 * already excludes it, but an unattended host auto-approving every tool call is
 * the one failure worth checking twice.
 */
function requireKnownRepoRoots(repoRoots: string[]): void {
  repoRoots.forEach(requireKnownRepoRoot);
}

/**
 * Reject a runner the host no longer has. `startAgent` would quietly fall back
 * to the default, which is the wrong answer for a deliberate pick.
 */
function requireKnownRunner(runnerId: string | undefined): void {
  if (runnerId && !getRunnerById(runnerId)) {
    throw new GatewayError("not_found", `unknown runner ${runnerId}`);
  }
}

function requireRemotePermissionMode(mode: string | undefined): void {
  if (mode && !["ask", "auto", "plan", "review"].includes(mode)) {
    throw new GatewayError("capability_denied", `permission mode ${mode}`);
  }
}

/** The account list in wire shape — shared with the accounts-changed bridge. */
export function remoteClaudeAccounts(): {
  accounts: RemoteClaudeAccount[];
  active_id: string;
} {
  return {
    accounts: refreshAllAccountIdentities().map((a) => ({
      id: a.id,
      label: a.label ?? null,
      email: a.email ?? null,
      org_name: a.org_name ?? null,
      subscription_type: a.subscription_type ?? null,
      needs_reauth: a.needs_reauth === true,
      rate_limited: a.rate_limited === true,
      account_type: a.account_type,
    })),
    active_id: getActiveAccountId(),
  };
}

/** Run a control-service call, mapping its string throws to gateway errors. */
async function control<T>(fn: () => Promise<T> | T): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof GatewayError) {
      throw err;
    }
    throw new GatewayError(
      "bad_request",
      err instanceof Error ? err.message : String(err),
    );
  }
}

const HANDLERS: Record<RemoteMethod, Handler> = {
  // Lets a client re-sync every address on connect, so a phone that paired on
  // the LAN can reach this desktop over a tunnel without being re-paired.
  "host.endpoints": async () => {
    return { endpoints: getEndpoints() };
  },

  "account.status": async () => remoteAccountStatus(),
  // Only raises the console's own link prompt; the host still has to confirm.
  "account.request_link": () => control(() => requestLinkFromPaired()),
  // Signed entries verify against this host's own log; no tier gate beyond
  // monitor, so a monitor-only phone's removals still land.
  "account.sync": async (params) => {
    const { epoch, entries } = parse("account.sync", params);

    return applyPushedEntries(epoch, entries);
  },

  "projects.list": async () => {
    const projects = collectAllProjects().map((p) => ({
      repo_root: p.path,
      name: p.path.split("/").pop() ?? p.path,
    }));

    return { projects };
  },

  "sessions.list": async (params) => {
    const { repo_root } = parse("sessions.list", params);
    requireKnownRepoRoot(repo_root);
    const sessions = (await listSessions(repo_root)).map(toRemoteSession);

    return { sessions };
  },

  "scratch_pads.list": async (params) => {
    parse("scratch_pads.list", params);

    return { sessions: listScratchPads().map(toRemoteSession) };
  },

  "agents.list": async (params) => {
    const { session_id, repo_root } = parse("agents.list", params);
    if (repo_root) {
      requireKnownRepoRoot(repo_root);
    }
    const agents = [...appState.agents.values()]
      .filter((a) => {
        if (session_id) {
          return a.sessionId === session_id;
        }
        if (repo_root) {
          // All agents in the project, across every session incl. the root —
          // `sessions.list` omits project_root sessions, so filter by repo here.
          return appState.sessions.get(a.sessionId)?.repo_root === repo_root;
        }

        return true;
      })
      .map(toRemoteAgentStatus);

    return { agents };
  },

  "agents.status": async (params) => {
    const { agent_id } = parse("agents.status", params);
    const agent = appState.agents.get(agent_id);
    if (!agent) {
      throw new GatewayError("not_found", `no agent ${agent_id}`);
    }

    return { agent: toRemoteAgentStatus(agent) };
  },

  "agents.vitals": async (params) => {
    const { agent_id } = parse("agents.vitals", params);
    const a = appState.agents.get(agent_id);
    if (!a) {
      throw new GatewayError("not_found", `no agent ${agent_id}`);
    }

    return {
      vitals: {
        agent_id: a.agentId,
        status: a.status,
        last_event_at: a.lastEventAt,
        tool_uses_total: a.toolUsesTotal,
        last_tool_name: a.lastToolName,
        last_tool_use_at: a.lastToolUseAt,
        turns_completed: a.turnsCompleted,
      },
    };
  },

  "agents.transcript": async (params) => {
    const { agent_id, after, before, limit } = parse(
      "agents.transcript",
      params,
    );
    // The cursor first: reading it sends any pending delta, so the page and
    // the deltas that follow it line up.
    const cursor = liveCursor(agent_id);
    const conv = liveTranscript(agent_id);

    return {
      ...transcriptPage(conv, { after, before, limit }),
      ...(cursor ?? {}),
      tasks: toRemoteTasks(conv),
      todos: toRemoteTodos(conv),
      follow_ups: conv.followUps ?? [],
      model: conv.model ?? null,
      pending_tool_name: conv.pendingToolName ?? null,
    };
  },

  "agents.image": async (params) => {
    const { agent_id, image_id } = parse("agents.image", params);
    const conv = liveTranscript(agent_id);
    const found = findImage(conv, image_id);
    if (!found) {
      throw new GatewayError("not_found", `no image ${image_id}`);
    }

    return { data: found.data, media_type: found.media_type };
  },

  "agents.stopped": async (params) => {
    const { repo_root, limit } = parse("agents.stopped", params);
    requireKnownRepoRoot(repo_root);
    // The index is already newest-first. Chat history is also written while an
    // agent is still running, so drop anything still live — those belong to
    // `agents.list`, and listing them here would double them up.
    //
    // Unasked, serve the whole index, as the desktop does: it is already
    // capped by the history's own retention, and a client that files these
    // under the session they ran in needs all of them to file.
    const index = loadHistoryIndex(repo_root).filter(
      (e) => !e.agentId || !appState.agents.has(e.agentId),
    );
    const agents = (limit === undefined ? index : index.slice(0, limit)).map(
      (e): RemoteStoppedAgent => ({
        history_id: e.id,
        runner_session_id: e.sessionId,
        title: e.title,
        branch: e.sessionBranch,
        description: e.sessionDescription,
        model: e.model ?? null,
        message_count: e.messageCount,
        started_at: e.createdAt,
        ended_at: e.endedAt,
        ...(e.importedFrom ? { imported_from: e.importedFrom } : {}),
      }),
    );

    return { agents };
  },

  "agents.stopped_transcript": async (params) => {
    const { repo_root, history_id, after, before, limit } = parse(
      "agents.stopped_transcript",
      params,
    );
    requireKnownHistoryRoot(repo_root);
    const conv = loadStoppedConversation(repo_root, history_id);

    return {
      ...transcriptPage(conv, { after, before, limit }, { settled: true }),
      model: conv.model ?? null,
    };
  },

  "agents.stopped_image": async (params) => {
    const { repo_root, history_id, image_id } = parse(
      "agents.stopped_image",
      params,
    );
    requireKnownHistoryRoot(repo_root);
    const found = findImage(
      loadStoppedConversation(repo_root, history_id),
      image_id,
    );
    if (!found) {
      throw new GatewayError("not_found", `no image ${image_id}`);
    }

    return { data: found.data, media_type: found.media_type };
  },

  "permission.respond": async (params, ctx) => {
    const { agent_id, tool_use_id, decision, message } = parse(
      "permission.respond",
      params,
    );
    // Only answer a prompt THIS gateway forwarded to THIS device — no
    // pre-authorization, no allow-rule injection. `message` rides along with a
    // deny to carry AskUserQuestion answers / plan feedback (never an allow
    // rule), keeping this within the monitor+approve scope.
    const key = permissionKey(agent_id, tool_use_id);
    if (!ctx.outstandingPermissions.has(key)) {
      throw new GatewayError("bad_request", "no such outstanding prompt");
    }
    respondToPermission(
      agent_id,
      tool_use_id,
      decision,
      undefined,
      false,
      decision === "deny" ? message : undefined,
    );
    ctx.outstandingPermissions.delete(key);

    return { accepted: true };
  },

  "device.rename": async (params, ctx) => {
    const { name } = parse("device.rename", params);
    await renameDevice(ctx.device.device_id, name);
    // Keep this connection's in-memory record in sync with the persisted label.
    ctx.device.label = name;

    return { accepted: true };
  },

  "device.capabilities": async (_params, ctx) => {
    return { capabilities: ctx.device.capabilities };
  },

  "device.push_info": async () => {
    const status = await getPushConfigStatus();

    return {
      configured: await isPushConfigured(),
      enabled: status.enabled,
      // Minted on first ask — web push needs no user-supplied credentials.
      vapid_public_key: status.enabled ? await ensureVapidPublicKey() : null,
      relay_url: status.enabled ? status.relayUrl : null,
    };
  },

  "device.register_push": async (params, ctx) => {
    const {
      service,
      token,
      environment,
      keys,
      push_key: pushKey,
      auth_key: authKey,
    } = parse("device.register_push", params);
    const registration = {
      service,
      token,
      environment,
      keys,
      push_key: pushKey,
      auth_key: authKey,
      updated_at: Date.now(),
    };
    await setDevicePush(ctx.device.device_id, registration);
    ctx.device.push = registration;

    // Tell the phone whether pushes will actually go anywhere, so its settings
    // screen can say "the desktop still needs credentials" instead of lying.
    return { accepted: true, configured: await isPushConfigured() };
  },

  "device.unregister_push": async (_params, ctx) => {
    await clearDevicePush(ctx.device.device_id);
    ctx.device.push = null;

    return { accepted: true };
  },

  // --- control-scoped ---------------------------------------------------

  "agents.capabilities": async (params) => {
    const { agent_id } = parse("agents.capabilities", params);
    const init = requireAgent(agent_id).handle.initializeResponse();
    if (!init) {
      throw new GatewayError("not_found", "capabilities not ready");
    }

    return { capabilities: toRemoteAgentCapabilities(init) };
  },

  "agents.send": async (params, ctx) => {
    const { agent_id, message, display_text, images } = parse(
      "agents.send",
      params,
    );
    requireAgent(agent_id);
    const author = messageAuthor(agent_id, ctx);

    // Loaded on use: the conversation stack reaches back to this gateway for push.
    const { submitAgentMessage } =
      await import("../agent/conversation/actions");
    const { queued } = await control(() =>
      submitAgentMessage(agent_id, {
        text: message,
        displayText: display_text,
        author,
        images,
      }),
    );

    return queued ? { accepted: true, queued: true } : { accepted: true };
  },

  "agents.interrupt": async (params) => {
    const { agent_id } = parse("agents.interrupt", params);
    requireAgent(agent_id);
    await control(() => interruptAgent(agent_id));

    return { accepted: true };
  },

  "agents.dismiss_limit_resume": async (params) => {
    const { agent_id } = parse("agents.dismiss_limit_resume", params);
    requireAgent(agent_id);
    await control(() => dismissLimitResume(agent_id));

    return { accepted: true };
  },

  "agents.stop": async (params) => {
    const { agent_id } = parse("agents.stop", params);
    requireAgent(agent_id);
    // stopAgent broadcasts agent:status:${id}="stopped", which the gateway
    // forwards, so both desktop and remote reflect the kill live.
    await control(() => stopAgent(agent_id));

    return { accepted: true };
  },

  "agents.set_model": async (params) => {
    const { agent_id, model } = parse("agents.set_model", params);
    await control(() => setAgentModel(agent_id, model));

    return { accepted: true };
  },

  "agents.set_claude_account": async (params) => {
    const { agent_id, account_id } = parse("agents.set_claude_account", params);
    const agent = requireAgent(agent_id);
    await control(() =>
      switchSessionClaudeAccount(agent.sessionId, account_id, agent_id),
    );

    return { accepted: true };
  },

  "agents.set_permission_mode": async (params) => {
    const { agent_id, mode } = parse("agents.set_permission_mode", params);
    requireRemotePermissionMode(mode);
    await control(() => setAgentPermissionMode(agent_id, mode));

    return { accepted: true };
  },

  "agents.set_effort": async (params) => {
    const { agent_id, level } = parse("agents.set_effort", params);
    await control(() => setAgentEffort(agent_id, level));

    return { accepted: true };
  },

  "agents.spawn": async (params) => {
    const { session_id, model, permission_mode, resume_session_id, runner_id } =
      parse("agents.spawn", params);
    requireRemotePermissionMode(permission_mode);
    requireKnownRunner(runner_id);
    const info = await control(() =>
      startAgent(
        session_id,
        model,
        permission_mode,
        resume_session_id,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        runner_id,
      ),
    );
    // Announce the agent exactly like the start_agent IPC does — the host's
    // conversation driver and every client listen for this. Without it the
    // agent is a backend-only "ghost": never shown on the desktop and with no
    // transcript for us to read back.
    emitHostEvent("agent:started", info);
    const agent = appState.agents.get(info.agent_id);
    if (!agent) {
      throw new GatewayError("internal", "spawned agent vanished");
    }

    return { agent: toRemoteAgentStatus(agent) };
  },

  "agents.queue_list": async (params) => {
    const { agent_id } = parse("agents.queue_list", params);

    return { messages: listQueue(agent_id) };
  },

  "agents.queue_add": async (params, ctx) => {
    const { agent_id, message, display_text, images } = parse(
      "agents.queue_add",
      params,
    );
    requireAgent(agent_id);
    const queued = await control(() =>
      enqueueMessage(agent_id, {
        text: message,
        displayText: display_text,
        author: messageAuthor(agent_id, ctx),
        images,
      }),
    );

    return { message: queued };
  },

  "agents.queue_remove": async (params) => {
    const { agent_id, id } = parse("agents.queue_remove", params);
    removeQueuedMessage(agent_id, id);

    return { accepted: true };
  },

  "agents.queue_update": async (params) => {
    const { agent_id, id, message } = parse("agents.queue_update", params);
    updateQueuedMessage(agent_id, id, message);

    return { accepted: true };
  },

  "agents.queue_send_now": async (params) => {
    const { agent_id, id } = parse("agents.queue_send_now", params);
    requireAgent(agent_id);
    const { sendQueuedMessageNow } =
      await import("../agent/conversation/hostDriver");

    return control(() => sendQueuedMessageNow(agent_id, id));
  },

  "sessions.create": async (params) => {
    const {
      repo_root,
      branch,
      description,
      use_existing_branch,
      base_branch,
      prompt,
      model,
      permission_mode,
      runner_id,
      linear_issue,
    } = parse("sessions.create", params);
    requireKnownRepoRoot(repo_root);
    requireRemotePermissionMode(permission_mode);
    requireKnownRunner(runner_id);
    if (linear_issue) {
      const start = await control(() =>
        prepareIssueStart(linear_issue, prompt ?? ""),
      );
      const session = await control(() =>
        createSession(
          repo_root,
          start.branch,
          start.description,
          false,
          base_branch,
          undefined,
          { linkedIssue: start.linkedIssue, designRefs: start.designRefs },
        ),
      );
      startAgentWhenReady(session.id, start.prompt, {
        model,
        permissionMode: permission_mode,
        runnerId: runner_id,
        images: start.images,
      }).catch(() => {});

      return { session: toRemoteSession(session) };
    }
    const session = await control(() =>
      createSession(
        repo_root,
        branch,
        description,
        use_existing_branch,
        base_branch,
      ),
    );
    if (prompt?.trim()) {
      startAgentWhenReady(session.id, prompt, {
        model,
        permissionMode: permission_mode,
        runnerId: runner_id,
      }).catch(() => {});
    }

    return { session: toRemoteSession(session) };
  },

  "scratch_pads.create": async (params) => {
    const { name } = parse("scratch_pads.create", params);
    const session = await control(() => createScratchPad({ name }));

    return { session: toRemoteSession(session) };
  },

  "sessions.files": async (params) => {
    const { session_id } = parse("sessions.files", params);
    const files = await control(() => listSessionFiles(session_id));

    return { files };
  },

  "files.read": async (params) => {
    const { session_id, path } = parse("files.read", params);
    requireSession(session_id);

    return control(() => readSessionFile(session_id, path));
  },

  "files.search": async (params) => {
    const p = parse("files.search", params);
    requireSession(p.session_id);

    return control(() => searchSessionFiles(p));
  },

  "files.search_cancel": async (params) => {
    const { session_id, search_id } = parse("files.search_cancel", params);

    return cancelSessionSearch(session_id, search_id);
  },

  "sessions.resolve_mention_path": async (params) => {
    const { session_id, query } = parse(
      "sessions.resolve_mention_path",
      params,
    );
    // Confine browsing to the session worktree plus registered projects so a
    // remote can @-mention a backend file in another project, but not read
    // arbitrary paths like `~/.ssh` or `/etc`.
    const projectRoots = collectAllProjects().map((p) => p.path);
    const { entries, resolvedPath } = await control(() =>
      resolveMentionPath(session_id, query, projectRoots),
    );

    return {
      entries: entries.map((e) => ({ name: e.name, is_dir: e.is_dir })),
      resolved_path: resolvedPath,
    };
  },

  "sessions.delete": async (params) => {
    const { id, delete_branch } = parse("sessions.delete", params);
    requireSession(id);
    await control(() => deleteSession(id, delete_branch));

    return { accepted: true };
  },

  "sessions.rename": async (params) => {
    const { id, display_name } = parse("sessions.rename", params);
    requireSession(id);
    await control(() => renameSession(id, display_name));

    return { accepted: true };
  },

  "sessions.rename_branch": async (params) => {
    const { id, branch } = parse("sessions.rename_branch", params);
    requireSession(id);
    await control(() => renameSessionBranch(id, branch));

    return { accepted: true };
  },

  "sessions.set_base_branch": async (params) => {
    const { id, base_branch } = parse("sessions.set_base_branch", params);
    requireSession(id);
    await control(() => setSessionBaseBranch(id, base_branch));

    return { accepted: true };
  },

  "sessions.retry_setup": async (params) => {
    const { id } = parse("sessions.retry_setup", params);
    requireSession(id);
    await control(() => retrySessionSetup(id));

    return { accepted: true };
  },

  "sessions.mark_ready": async (params) => {
    const { id } = parse("sessions.mark_ready", params);
    requireSession(id);
    const session = appState.sessions.get(id)!;
    const failed = typeof session.status === "object";
    await control(() => clearSessionSetupError(id));
    // The session's prompt was dropped when setup failed; hand it to an agent
    // now, same as the desktop's "Mark as ready".
    const prompt = session.description.trim();
    if (failed && prompt) {
      startAgentWhenReady(id, prompt).catch(() => {});
    }

    return { accepted: true };
  },

  "terminals.list": async (params) => {
    const { session_id } = parse("terminals.list", params);
    requireSession(session_id);

    return {
      terminals: listTerminals(session_id).map((t) => ({
        id: t.id,
        title: t.title,
        run_title: t.runTitle,
      })),
    };
  },

  "terminals.read": async (params) => {
    const { terminal_id } = parse("terminals.read", params);
    const terminal = appState.terminals.get(terminal_id);
    if (!terminal) {
      throw new GatewayError("not_found", `no terminal ${terminal_id}`);
    }
    const read = readTerminalOutput(terminal_id, {
      tailBytes: TERMINAL_READ_TAIL,
    });

    return {
      output: read.output,
      running: read.running,
      exit_code: read.exitCode,
      truncated:
        terminal.outputLog.length > TERMINAL_READ_TAIL || read.droppedBytes > 0,
    };
  },

  "terminals.scrollback": async (params) => {
    const { terminal_id } = parse("terminals.scrollback", params);
    if (!appState.terminals.has(terminal_id)) {
      throw new GatewayError("not_found", `no terminal ${terminal_id}`);
    }
    const scrollback = terminalScrollback(terminal_id);

    return {
      data: scrollback.data,
      truncated: scrollback.truncated,
      exit_code: scrollback.exitCode,
    };
  },

  "sessions.git_status": async (params) => {
    const { session_id } = parse("sessions.git_status", params);
    requireSession(session_id);
    const [s, diff] = await control(() =>
      Promise.all([gitStatus(session_id), computeSessionDiffStats(session_id)]),
    );

    return {
      status: {
        branch: s.branch,
        upstream: s.upstream,
        ahead: s.ahead,
        behind: s.behind,
        dirty_count: s.dirtyCount,
        stash_count: s.stashCount,
        conflict_count: s.conflictCount,
        detached: s.detached,
        last_fetch_at: s.lastFetchAt,
        in_progress: s.inProgress
          ? {
              kind: s.inProgress.kind,
              head: s.inProgress.head,
              onto: s.inProgress.onto,
            }
          : null,
        diff_additions: diff.additions,
        diff_deletions: diff.deletions,
      } satisfies RemoteGitStatus,
    };
  },

  "sessions.branches": async (params) => {
    const { session_id } = parse("sessions.branches", params);
    requireSession(session_id);
    const [local, remote] = await control(() =>
      Promise.all([
        gitListLocalBranches(session_id),
        gitListRemoteBranches(session_id),
      ]),
    );
    const localNames = new Set(local.map((b) => b.name));
    const repoRoot = appState.sessions.get(session_id)?.repo_root;
    const pinned = new Set(repoRoot ? listPinnedBranches(repoRoot) : []);
    const branches: RemoteGitBranch[] = [
      ...local.map((b) => ({
        name: b.name,
        scope: "local" as const,
        is_current: b.isCurrent,
        pinned: pinned.has(b.name),
        upstream: b.upstream,
        ahead: b.ahead,
        behind: b.behind,
        last_commit_subject: b.lastCommit?.subject,
        last_commit_at: b.lastCommit?.timestamp,
      })),
      // Remote-only branches: checking one out DWIMs a local tracking branch.
      ...remote
        .filter((b) => !localNames.has(b.branchName))
        .map((b) => ({
          name: b.branchName,
          scope: "remote" as const,
          remote: b.remote,
          is_current: false,
          ahead: 0,
          behind: 0,
          last_commit_subject: b.lastCommit?.subject,
          last_commit_at: b.lastCommit?.timestamp,
        })),
    ];

    return { branches };
  },

  "sessions.checkout": async (params) => {
    const { session_id, branch, dirty } = parse("sessions.checkout", params);
    requireSession(session_id);
    try {
      if (dirty === "stash") {
        await gitStashAndCheckout(session_id, { branch });
      } else if (dirty === "discard") {
        await gitDiscardAndCheckout(session_id, { branch });
      } else {
        await gitCheckout(session_id, { branch });
      }
    } catch (err) {
      // Report a dirty tree back instead of failing, so the client can offer
      // stash/discard the way the desktop's checkout dialog does.
      if (err instanceof GitError && err.kind === "dirty-working-tree") {
        return { accepted: false, blocked_by: "dirty" as const };
      }
      throw new GatewayError(
        "bad_request",
        err instanceof Error ? err.message : String(err),
      );
    }

    return { accepted: true };
  },

  "sessions.create_branch": async (params) => {
    const { session_id, name, start_point, checkout } = parse(
      "sessions.create_branch",
      params,
    );
    requireSession(session_id);
    await control(() =>
      gitCreateBranch(session_id, {
        name,
        startPoint: start_point,
        checkout: checkout ?? true,
      }),
    );

    return { accepted: true };
  },

  "sessions.delete_branch": async (params) => {
    const { session_id, name, force } = parse("sessions.delete_branch", params);
    requireSession(session_id);
    try {
      await gitDeleteBranch(session_id, { name, force });
    } catch (err) {
      // Unmerged commits are a question for the user, not a failure — the
      // client re-sends with force once they confirm.
      if (!force && isUnmergedBranch(err)) {
        return { accepted: false, blocked_by: "unmerged" as const };
      }
      throw new GatewayError(
        "bad_request",
        err instanceof Error ? err.message : String(err),
      );
    }

    return { accepted: true };
  },

  "sessions.branch_log": async (params) => {
    const { session_id, branch, count } = parse("sessions.branch_log", params);
    requireSession(session_id);

    return {
      commits: await control(() => branchLog(session_id, branch, count)),
    };
  },

  "sessions.commit_diff": async (params) => {
    const { session_id, hash } = parse("sessions.commit_diff", params);
    requireSession(session_id);

    return { diff: await control(() => commitDiff(session_id, hash)) };
  },

  "sessions.compare_branches": async (params) => {
    const { session_id, left, right } = parse(
      "sessions.compare_branches",
      params,
    );
    requireSession(session_id);

    return await control(() => compareBranches(session_id, left, right));
  },

  "sessions.branch_pr_url": async (params) => {
    const { session_id, branch } = parse("sessions.branch_pr_url", params);
    requireSession(session_id);

    return { url: await control(() => branchPrUrl(session_id, branch)) };
  },

  // A merge or rebase that stops on conflicts comes back as git's message;
  // resolving it is a desktop job.
  "sessions.merge_branch": async (params) => {
    const { session_id, from, squash } = parse("sessions.merge_branch", params);
    requireSession(session_id);
    await control(() => mergeIntoCurrent(session_id, from, squash ?? false));

    return { accepted: true };
  },

  "sessions.rebase_current": async (params) => {
    const { session_id, onto } = parse("sessions.rebase_current", params);
    requireSession(session_id);
    await control(() => rebaseCurrent(session_id, onto));

    return { accepted: true };
  },

  "sessions.push_branch": async (params) => {
    const { session_id, branch, remote, set_upstream, force_with_lease } =
      parse("sessions.push_branch", params);
    requireSession(session_id);

    return {
      output: await control(() =>
        pushBranch(session_id, {
          branch,
          remote,
          setUpstream: set_upstream,
          forceWithLease: force_with_lease,
        }),
      ),
    };
  },

  "sessions.pull": async (params) => {
    const { session_id, strategy } = parse("sessions.pull", params);
    requireSession(session_id);

    return { output: await control(() => pullCurrent(session_id, strategy)) };
  },

  "sessions.rename_local_branch": async (params) => {
    const { session_id, from, to } = parse(
      "sessions.rename_local_branch",
      params,
    );
    requireSession(session_id);
    await control(() => renameLocalBranch(session_id, from, to));

    return { accepted: true };
  },

  "sessions.pin_branch": async (params) => {
    const { session_id, branch, pinned } = parse("sessions.pin_branch", params);
    requireSession(session_id);

    return {
      pinned: await control(() => setBranchPinned(session_id, branch, pinned)),
    };
  },

  "sessions.diff": async (params) => {
    const { session_id, mode } = parse("sessions.diff", params);
    requireSession(session_id);
    const diff = await control(() =>
      mode === "working"
        ? getSessionFullDiff(session_id)
        : getSessionBranchDiff(session_id, {}),
    );
    const base = appState.sessions.get(session_id)?.base_branch ?? null;

    return { diff, base_branch: base };
  },
  "sessions.commit": async (params) => {
    const { session_id, message, stage_all, amend } = parse(
      "sessions.commit",
      params,
    );
    requireSession(session_id);
    const output = await control(async () => {
      // A phone reviews whole files, so everything goes in unless the caller
      // says otherwise — a commit of nothing is the confusing alternative.
      if (stage_all !== false) {
        await stageAll(session_id);
      }

      return await gitCommit(session_id, message, amend ?? false);
    });

    return { output };
  },
  "sessions.stashes": async (params) => {
    const { session_id } = parse("sessions.stashes", params);
    requireSession(session_id);

    return { stashes: await gitStashList(session_id) };
  },
  "sessions.stash_apply": async (params) => {
    const { session_id, index, drop } = parse("sessions.stash_apply", params);
    requireSession(session_id);
    const output = await control(async () => {
      const applied = await gitStashApply(session_id, index);

      // Dropped only once the apply went through, so a conflict keeps it.
      return drop
        ? `${applied}\n${await gitStashDrop(session_id, index)}`.trim()
        : applied;
    });

    return { output };
  },
  "sessions.stash_drop": async (params) => {
    const { session_id, index } = parse("sessions.stash_drop", params);
    requireSession(session_id);

    return { output: await control(() => gitStashDrop(session_id, index)) };
  },
  "sessions.tags": async (params) => {
    const { session_id } = parse("sessions.tags", params);
    requireSession(session_id);

    return { tags: await gitListTags(session_id) };
  },
  "sessions.push": async (params) => {
    const { session_id } = parse("sessions.push", params);
    requireSession(session_id);
    const result = await control(() => pushSessionBranch(session_id));

    return {
      branch: result.branch,
      remote: result.remoteName,
      pr_url: result.prUrl,
    };
  },
  "sessions.merge_blockers": async (params) => {
    const { session_id } = parse("sessions.merge_blockers", params);
    requireSession(session_id);
    const blockers = await control(() => getSessionMergeBlockers(session_id));

    return { blockers };
  },
  "sessions.merge_base": async (params) => {
    const { session_id, strategy } = parse("sessions.merge_base", params);
    requireSession(session_id);
    // The host refuses a protected base branch and pre-checks for conflicts,
    // so nothing extra is gated here.
    await control(() => mergeSessionIntoBase(session_id, strategy));

    return { accepted: true };
  },
  "automations.list": async () => remoteAutomations(),
  "automations.runs": async (params) =>
    remoteAutomationRuns(parse("automations.runs", params)),
  "automations.run": async (params) => {
    const { run_id } = parse("automations.run", params);
    const detail = remoteAutomationRun(run_id);
    if (!detail) {
      throw new GatewayError("not_found", `no run ${run_id}`);
    }

    return detail;
  },
  "automations.get": async (params) => {
    const { automation_id } = parse("automations.get", params);
    const detail = remoteAutomation(automation_id);
    if (!detail) {
      throw new GatewayError("not_found", `no automation ${automation_id}`);
    }

    return detail;
  },
  "automations.sources": async () => await remoteSignalSources(),
  "automations.runners": async () => remoteRunners(),
  "automations.create": async (params) => {
    const { input } = parse("automations.create", params);
    requireKnownRepoRoots(input.repo_roots);

    return await control(() => createRemoteAutomation(input));
  },
  "automations.update": async (params) => {
    const { automation_id, patch } = parse("automations.update", params);
    if (patch.repo_roots) {
      requireKnownRepoRoots(patch.repo_roots);
    }

    return await control(() => updateRemoteAutomation(automation_id, patch));
  },
  "automations.revise_playbook": async (params) => {
    const { playbook, instruction, name } = parse(
      "automations.revise_playbook",
      params,
    );

    // Not wrapped in `control()`: nothing on the host changes. The rewrite
    // goes back to the phone, and only an `automations.update` saves it.
    return await revisePlaybook({ playbook, instruction, name });
  },
  "automations.memories": async (params) => {
    const { automation_id } = parse("automations.memories", params);
    if (!remoteAutomation(automation_id)) {
      throw new GatewayError("not_found", `no automation ${automation_id}`);
    }

    return { memories: listAutomationMemories(automation_id).memories };
  },
  "automations.save_memory": async (params) => {
    const { automation_id, memory } = parse("automations.save_memory", params);

    return await control(() => ({
      memory: saveAutomationMemory(automation_id, memory),
    }));
  },
  "automations.delete_memory": async (params) => {
    const { automation_id, name } = parse("automations.delete_memory", params);

    return await control(() => {
      deleteAutomationMemory(automation_id, name);

      return { accepted: true };
    });
  },
  "automations.delete": async (params) => {
    const { automation_id } = parse("automations.delete", params);

    return await control(() => deleteRemoteAutomation(automation_id));
  },
  "automations.set_enabled": async (params) => {
    const { automation_id, enabled } = parse("automations.set_enabled", params);

    return await control(() =>
      setRemoteAutomationEnabled(automation_id, enabled),
    );
  },
  "automations.run_now": async (params) => {
    const { automation_id } = parse("automations.run_now", params);
    // Returns as soon as the record exists — a run that could not start is a
    // `skipped` record with the reason on it, not a thrown error.
    const run = await control(() =>
      startAutomationRun(automation_id, "manual (remote)"),
    );

    return { run: toRemoteAutomationRun(run) };
  },
  "automations.run_scratch": async (params) => {
    const input = parse("automations.run_scratch", params);
    requireKnownRepoRoots(input.repo_roots);

    return await control(() => startRemoteScratchRun(input));
  },
  "automations.save_scratch_run": async (params) => {
    const { run_id, name, description, enabled } = parse(
      "automations.save_scratch_run",
      params,
    );

    return await control(() =>
      saveRemoteScratchRun(run_id, { name, description, enabled }),
    );
  },
  "automations.cancel_run": async (params) => {
    const { run_id } = parse("automations.cancel_run", params);
    await control(() => cancelAutomationRun(run_id));

    return { accepted: true };
  },
  "automations.delete_run": async (params) => {
    const { run_id } = parse("automations.delete_run", params);
    if (!getAutomationRun(run_id)) {
      throw new GatewayError("not_found", `no run ${run_id}`);
    }
    await control(() => deleteRun(run_id));

    return { accepted: true };
  },
  "automations.calibration": async (params) => {
    const { automation_id } = parse("automations.calibration", params);
    if (!getAutomation(automation_id)) {
      throw new GatewayError("not_found", `no automation ${automation_id}`);
    }

    return calibrationFor(automation_id);
  },
  "automations.draft": async (params) => {
    const { description, timezone } = parse("automations.draft", params);

    // Spends the host's LLM, so it is gated like any other run.
    return control(() => remoteAutomationDraft(description, timezone));
  },
  "automations.default_autonomy": async (params) => {
    parse("automations.default_autonomy", params);

    return { autonomy: appDefaultAutonomy() };
  },
  "automations.set_default_autonomy": async (params) => {
    const { autonomy } = parse("automations.set_default_autonomy", params);
    await control(() => saveAppSettings({ default_autonomy: autonomy }));

    return { autonomy: appDefaultAutonomy() };
  },
  "integrations.list": async () => ({ integrations: listIntegrations() }),

  "linear.issues": async (params) => {
    const { query, scope, limit } = parse("linear.issues", params);
    const issues = await control(() =>
      listLinearIssues(query ?? null, limit ?? 30, scope),
    );

    return { issues };
  },
  "linear.issue": async (params) => {
    const { ref } = parse("linear.issue", params);
    const issue = await control(() => getLinearIssue(ref));
    // The picker falls back to the issue's own state without the workflow.
    const states = issue
      ? await linearTeamStates(issue.teamId).catch(() => [])
      : [];

    return { issue, states };
  },
  "linear.update_issue": async (params) => {
    const { issue_id, state_id, priority } = parse(
      "linear.update_issue",
      params,
    );
    if (state_id === undefined && priority === undefined) {
      throw new GatewayError("bad_request", "nothing to change");
    }
    const issue = await control(() =>
      updateLinearIssue(issue_id, { stateId: state_id, priority }),
    );

    return { issue };
  },
  "linear.comment": async (params) => {
    const { issue_id, body } = parse("linear.comment", params);
    await control(() => commentOnLinearIssueById(issue_id, body));

    return { accepted: true };
  },
  "figma.frame_details": async (params) => {
    const { url } = parse("figma.frame_details", params);

    return { details: await control(() => figmaFrameDetails(url)) };
  },
  "design.compare": async (params) => {
    const { url, platform, device_key } = parse("design.compare", params);
    const comparison = await control(async () => {
      const png = await devicePng(platform, device_key);
      if (!png) {
        throw new Error("Couldn't take a screenshot of that device.");
      }

      return compareToDesign(url, png, "app");
    });

    return { comparison };
  },

  "github.pull_requests": async (params) => {
    const { repo_roots } = parse("github.pull_requests", params);
    const roots = repo_roots ?? collectAllProjects().map((p) => p.path);
    roots.forEach(requireKnownRepoRoot);

    return await remotePullRequests(roots);
  },
  "github.pull_request": async (params) => {
    const { repo, number } = parse("github.pull_request", params);

    return await remotePullRequest(repo, number);
  },
  "github.create_pull_request": async (params) => {
    const { session_id, title, body, draft } = parse(
      "github.create_pull_request",
      params,
    );
    requireSession(session_id);

    return await control(() =>
      createRemotePullRequest({
        sessionId: session_id,
        title,
        body,
        draft: draft ?? true,
      }),
    );
  },
  "github.merge_pull_request": async (params) => {
    const { repo, number, strategy } = parse(
      "github.merge_pull_request",
      params,
    );

    return await control(() => mergeRemotePullRequest(repo, number, strategy));
  },
  "github.comment_pull_request": async (params) => {
    const { repo, number, body } = parse("github.comment_pull_request", params);

    return await control(() => commentOnRemotePullRequest(repo, number, body));
  },
  "proposals.list": async (params) =>
    remoteProposals(parse("proposals.list", params)),
  "proposals.accept": async (params) => {
    const { proposal_id, note } = parse("proposals.accept", params);

    // Starting a worktree and an agent is code execution, so it goes through
    // the same control gate a remote `agents.send` does.
    return control(() => acceptRemoteProposal(proposal_id, note));
  },
  "proposals.get": async (params) => {
    const { proposal_id } = parse("proposals.get", params);
    const found = remoteProposal(proposal_id);
    if (!found) {
      throw new GatewayError("not_found", `no proposal ${proposal_id}`);
    }

    return found;
  },
  "proposals.request_revision": async (params) => {
    const { proposal_id, note } = parse("proposals.request_revision", params);
    if (!remoteProposal(proposal_id)) {
      throw new GatewayError("not_found", `no proposal ${proposal_id}`);
    }

    return control(() => requestRemoteProposalRevision(proposal_id, note));
  },
  "proposals.perform_cleanup": async (params) => {
    const { proposal_id } = parse("proposals.perform_cleanup", params);

    // Deleting a branch or a worktree is not recoverable, so it is gated the
    // same way starting one is: never a monitor, never a huddle guest.
    return control(() => performRemoteProposalCleanup(proposal_id));
  },
  "proposals.resolve": async (params) => {
    const { proposal_id, note } = parse("proposals.resolve", params);
    const resolved = await control(() =>
      resolveRemoteProposal(proposal_id, note),
    );
    if (!resolved) {
      throw new GatewayError("not_found", `no proposal ${proposal_id}`);
    }

    return resolved;
  },
  "proposals.dismiss": async (params) => {
    const { proposal_id, reason } = parse("proposals.dismiss", params);
    const dismissed = await control(() =>
      dismissRemoteProposal(proposal_id, reason),
    );
    if (!dismissed) {
      throw new GatewayError("not_found", `no proposal ${proposal_id}`);
    }

    return dismissed;
  },
  "automations.mark_run_read": async (params) => {
    const { run_id } = parse("automations.mark_run_read", params);
    const marked = markRemoteRunRead(run_id);
    if (!marked) {
      throw new GatewayError("not_found", `no run ${run_id}`);
    }

    return marked;
  },
  "automations.run_feedback": async (params) => {
    const { run_id, note, allow_clearing } = parse(
      "automations.run_feedback",
      params,
    );

    return await control(() =>
      submitRemoteRunFeedback({ run_id, note, allow_clearing }),
    );
  },
  "devices.list": async () => {
    // A missing toolchain (no Xcode / no Android SDK) contributes an empty
    // list rather than failing the whole call.
    const [ios, android] = await Promise.all([
      listAllSimulators().catch(() => []),
      listAndroidDevices().catch(() => []),
    ]);
    const devices: RemoteDevice[] = [
      ...ios.filter((d) => d.booted).map(iosToRemoteDevice),
      ...android.filter((d) => d.online).map(androidToRemoteDevice),
    ];

    return { devices };
  },
  "device_hosts.list": async () => ({
    hosts: [
      ...listDeviceHosts().map(({ id, label, status }) => ({
        id,
        label,
        status,
        kind: "ssh" as const,
      })),
      ...remoteEasDeviceHosts(),
    ],
  }),
  "device_hosts.start_eas_session": async (params) => {
    const { host_id } = parse("device_hosts.start_eas_session", params);

    return { device_id: await control(() => startEasSession(host_id)) };
  },
  "device_hosts.stop_eas_session": async (params) => {
    const { device_id } = parse("device_hosts.stop_eas_session", params);
    await control(() => stopEasSession(device_id));

    return { accepted: true };
  },
  "devices.watch": async (params, ctx) => {
    const { device_id, platform } = parse("devices.watch", params);
    if (!ctx.media) {
      throw new GatewayError("internal", "media channel unavailable");
    }
    // Watching is monitor-tier; booting an EAS device would start a billed session.
    if (isEasDeviceId(device_id) && !runningEasDevice(device_id)) {
      throw new GatewayError(
        "bad_request",
        "That EAS Simulator session isn't running.",
      );
    }
    const stream_id = await control(() =>
      ctx.media!.watch(device_id, platform),
    );

    return { stream_id };
  },
  "devices.unwatch": async (params, ctx) => {
    const { device_id } = parse("devices.unwatch", params);
    ctx.media?.unwatch(device_id);
    // A client that stopped watching can't be interacting either.
    releaseDevice(device_id, ctx.connectionId);

    return { accepted: true };
  },
  "browser.watch": async (params, ctx) => {
    const { session_id } = parse("browser.watch", params);
    if (!ctx.media) {
      throw new GatewayError("internal", "media channel unavailable");
    }

    return { stream_id: ctx.media.watchBrowser(session_id) };
  },
  "browser.unwatch": async (params, ctx) => {
    const { session_id } = parse("browser.unwatch", params);
    ctx.media?.unwatchBrowser(session_id);
    // A client that stopped watching can't be driving the browser either.
    releaseDevice(browserClaimId(session_id), ctx.connectionId);

    return { accepted: true };
  },
  "devices.claim": async (params, ctx) => {
    const { device_id, force } = parse("devices.claim", params);

    return claimDevice(device_id, claimHolder(ctx), force ?? false);
  },
  "devices.release": async (params, ctx) => {
    const { device_id } = parse("devices.release", params);
    releaseDevice(device_id, ctx.connectionId);

    return { accepted: true };
  },
  "devices.claim_status": async (params, ctx) => {
    const { device_id } = parse("devices.claim_status", params);

    return { holder: getClaim(device_id), connection_id: ctx.connectionId };
  },
  "devices.state": async (params) => {
    const { device_id, platform } = parse("devices.state", params);
    if (platform !== "ios") {
      return { state: null };
    }

    return {
      state: toRemoteDeviceState(await simulatorDeviceState(device_id)),
    };
  },
  "devices.set_orientation": async (params, ctx) => {
    const { device_id, platform, orientation } = parse(
      "devices.set_orientation",
      params,
    );
    if (platform !== "ios") {
      throw new GatewayError("bad_request", "rotation is iOS-only");
    }
    requireDeviceInput(device_id, ctx);
    const state = await control(() =>
      simulatorSetOrientation(device_id, orientation),
    );

    return { state: toRemoteDeviceState(state) };
  },
  "devices.set_fold": async (params, ctx) => {
    const { device_id, platform, pose } = parse("devices.set_fold", params);
    if (platform !== "ios") {
      throw new GatewayError("bad_request", "folding is iOS-only");
    }
    requireDeviceInput(device_id, ctx);
    const state = await control(() => simulatorSetFold(device_id, pose));

    return { state: toRemoteDeviceState(state) };
  },
  "devices.touch": async (params, ctx) => {
    const { device_id, platform, x, y, event_type } = parse(
      "devices.touch",
      params,
    );
    requireDeviceInput(device_id, ctx);
    await control(() =>
      platform === "ios"
        ? simulatorTouch(device_id, x, y, event_type)
        : androidTouch(device_id, x, y, event_type),
    );

    return { accepted: true };
  },
  "devices.button": async (params, ctx) => {
    const { device_id, platform, button } = parse("devices.button", params);
    requireDeviceInput(device_id, ctx);
    await control(() =>
      platform === "ios"
        ? simulatorButton(device_id, button)
        : androidButton(device_id, button),
    );

    return { accepted: true };
  },
  "devices.keyboard": async (params, ctx) => {
    const { device_id, platform, key_code, modifiers, is_down } = parse(
      "devices.keyboard",
      params,
    );
    requireDeviceInput(device_id, ctx);
    await control(() =>
      platform === "ios"
        ? simulatorKeyboard(device_id, key_code, modifiers, is_down)
        : androidKeyboard(device_id, key_code, modifiers, is_down),
    );

    return { accepted: true };
  },

  // --- Claude accounts ------------------------------------------------------
  // Reused by the accounts-changed bridge in gateway.ts, so the client gets the
  // new list rather than a nudge to refetch.
  "claude_accounts.list": async () => {
    recheckFlaggedAccounts();

    return remoteClaudeAccounts();
  },

  "usage.limits": async (params) => {
    const { refresh } = parse("usage.limits", params);

    return getClaudeUsageLimits(refresh ?? false);
  },

  "usage.summary": async (params) => {
    const { range } = parse("usage.summary", params);

    return getClaudeUsageSummary(range);
  },

  "claude_accounts.set_active": async (params) => {
    const { id } = parse("claude_accounts.set_active", params);
    await control(() => {
      setActiveAccount(id);
      emitAccountsChanged();
    });

    return { accepted: true };
  },

  "claude_accounts.add": async (params) => {
    const { use_console } = parse("claude_accounts.add", params);
    const { url } = await control(() =>
      claudeAddAccount({ useConsole: use_console }),
    );

    return { url };
  },

  "claude_accounts.remove": async (params) => {
    const { id } = parse("claude_accounts.remove", params);
    await control(async () => {
      await removeClaudeAccount(id);
      emitAccountsChanged();
    });

    return { accepted: true };
  },

  "claude_accounts.rename": async (params) => {
    const { id, label } = parse("claude_accounts.rename", params);
    await control(() => {
      renameClaudeAccount(id, label);
      emitAccountsChanged();
    });

    return { accepted: true };
  },

  "claude_accounts.login_start": async (params) => {
    const { account_id, use_console } = parse(
      "claude_accounts.login_start",
      params,
    );
    const { url } = await control(() =>
      claudeLoginStart({ accountId: account_id, useConsole: use_console }),
    );

    return { url };
  },

  "claude_accounts.login_cancel": async () => {
    await control(() => claudeLoginCancel());

    return { accepted: true };
  },

  "claude_accounts.login_submit_code": async (params) => {
    const { code } = parse("claude_accounts.login_submit_code", params);

    return await control(() => claudeLoginSubmitCode({ code }));
  },

  "claude_accounts.login_status": async () => getClaudeLoginState(),
};

/**
 * Strip "admin" from a grant that is about to be scoped. Admin is the raw IPC
 * passthrough — scoping it is not meaningful — so a scoped grant can only ever
 * be monitor/control. Call this wherever a scoped grant is minted; `dispatch`
 * enforces the same rule again at call time.
 */
export function scopeSafeCapabilities(
  capabilities: readonly Capability[],
): Capability[] {
  return capabilities.filter((c) => c !== "admin");
}

/**
 * Admin implies the narrower tiers — it is a superset, not a sibling. A scoped
 * context is the exception: its admin grant (if one ever got minted) counts for
 * nothing, so it can neither satisfy `admin` nor imply control/monitor.
 */
function hasCapability(ctx: GatewayContext, required: Capability): boolean {
  const granted = ctx.scope
    ? scopeSafeCapabilities(ctx.device.capabilities)
    : ctx.device.capabilities;

  return granted.includes(required) || granted.includes("admin");
}

/** Sessions the scoped agents are running in — nothing else is addressable. */
function scopedSessionIds(scope: GrantScope): Set<string> {
  const ids = new Set<string>();
  for (const agentId of scope.agent_ids) {
    const sessionId = appState.agents.get(agentId)?.sessionId;
    if (sessionId) {
      ids.add(sessionId);
    }
  }

  return ids;
}

/** Repos behind the scoped agents' sessions. */
function scopedRepoRoots(scope: GrantScope): Set<string> {
  const roots = new Set<string>();
  for (const sessionId of scopedSessionIds(scope)) {
    const repoRoot = appState.sessions.get(sessionId)?.repo_root;
    if (repoRoot) {
      roots.add(repoRoot);
    }
  }

  return roots;
}

function denyScope(method: string): never {
  throw new GatewayError(
    "capability_denied",
    `${method} is outside this grant's scope`,
  );
}

/**
 * Second gate, after the capability tier: a scoped grant may only address what
 * its scope names. Unscoped contexts — every paired device today — skip this
 * entirely, so their behaviour is unchanged.
 */
function requireInScope(
  method: RemoteMethod,
  params: unknown,
  scope: GrantScope,
): void {
  const rule = METHOD_SCOPE[method];
  if (rule.kind === "open" || rule.kind === "filter") {
    return;
  }
  if (rule.kind === "denied") {
    denyScope(method);
  }
  // Read the subject off the raw params: the schema parse happens inside the
  // handler, and a malformed request must be denied, not let through.
  const subject = (params as Record<string, unknown> | null | undefined)?.[
    rule.param
  ];
  if (typeof subject !== "string") {
    denyScope(method);
  }
  const allowed = {
    agent: () => isAgentInScope(scope, subject),
    device: () => isDeviceInScope(scope, subject),
    browser: () => isBrowserInScope(scope, subject),
    session: () => scopedSessionIds(scope).has(subject),
  }[rule.kind]();
  if (!allowed) {
    denyScope(method);
  }
}

/**
 * Narrow an enumerating method's result to the scope, so a guest sees one agent
 * instead of an error. Refusing these would make the client unusable — it has
 * to list something before it can address anything.
 */
function filterForScope(
  method: RemoteMethod,
  result: unknown,
  scope: GrantScope,
): unknown {
  const r = result as Record<string, unknown[]>;
  switch (method) {
    case "projects.list": {
      const roots = scopedRepoRoots(scope);

      return {
        projects: (r.projects as { repo_root: string }[]).filter((p) =>
          roots.has(p.repo_root),
        ),
      };
    }
    case "sessions.list":
    case "scratch_pads.list": {
      const ids = scopedSessionIds(scope);

      return {
        sessions: (r.sessions as { id: string }[]).filter((s) => ids.has(s.id)),
      };
    }
    case "agents.list":
      return {
        agents: (r.agents as { agent_id: string }[]).filter((a) =>
          isAgentInScope(scope, a.agent_id),
        ),
      };
    // Stopped agents are keyed by history id, so none of them can be in scope.
    case "agents.stopped":
      return { agents: [] };
    case "devices.list":
      return {
        devices: (r.devices as { id: string }[]).filter((d) =>
          isDeviceInScope(scope, d.id),
        ),
      };
    default:
      return result;
  }
}

/**
 * Raw input commands and the param field naming what they drive. Admin rides
 * the passthrough, so without this it would skip the arbitration the typed
 * `devices.*` path gets and two desktops would both inject into one sim — or
 * both steer one embedded browser.
 *
 * `browser` entries are namespaced by `browserClaimId` so a session id can
 * never collide with a simulator UDID in the shared claim table.
 */
const ADMIN_INPUT_SUBJECT: Record<string, { browser?: true; param: string }> = {
  simulator_touch: { param: "udid" },
  simulator_button: { param: "udid" },
  simulator_keyboard: { param: "udid" },
  android_touch: { param: "serial" },
  android_button: { param: "serial" },
  android_keyboard: { param: "serial" },
  // Pointer, key and wheel input into the embedded browser, plus the
  // navigation that changes what every viewer of it sees.
  browser_mouse_event: { browser: true, param: "sessionId" },
  browser_keyboard_event: { browser: true, param: "sessionId" },
  browser_wheel_event: { browser: true, param: "sessionId" },
  browser_view_navigate: { browser: true, param: "sessionId" },
  browser_view_back: { browser: true, param: "sessionId" },
  browser_view_forward: { browser: true, param: "sessionId" },
  browser_view_reload: { browser: true, param: "sessionId" },
  browser_update_preset: { browser: true, param: "sessionId" },
};

/**
 * Run a raw command on behalf of an admin device — the same command the host's
 * own renderer would invoke, looked up in the shared registry. The registry's
 * tier is the bound: "host" never leaves the machine.
 *
 * This tier deliberately inverts the model: monitor/control are an allowlist,
 * admin is a denylist. An allowlist exists to constrain a phone, but a Mac you
 * own driving your own host is the same trust level as sitting at its keyboard,
 * and an admin grant is a console-confirmed pairing against a pinned key that
 * you can revoke. Never grant it to a browser.
 */
async function dispatchAdmin(
  command: string,
  params: unknown,
  ctx: GatewayContext,
): Promise<unknown> {
  // Belt and braces: a scoped grant is never admin (see `hasCapability`), so
  // this is unreachable — but the passthrough is 200-odd unscopable commands,
  // and the safe answer for a scoped context is always no.
  if (ctx.scope) {
    throw new GatewayError(
      "capability_denied",
      "scoped grants cannot use the admin passthrough",
    );
  }
  const definition = getCommand(command);
  if (!definition) {
    throw unknownMethodError("not_found", command, "command");
  }
  if (definition.tier === "host") {
    if (!ctx.console) {
      throw new GatewayError(
        "capability_denied",
        `host-only command ${command}`,
      );
    }
  } else if (!hasCapability(ctx, definition.tier)) {
    throw new GatewayError(
      "capability_denied",
      `device lacks '${definition.tier}' capability`,
    );
  }

  const args = (params ?? {}) as Record<string, unknown>;

  const subject = ADMIN_INPUT_SUBJECT[command];
  const subjectId = subject ? args[subject.param] : undefined;
  if (typeof subjectId === "string") {
    requireDeviceInput(
      subject?.browser ? browserClaimId(subjectId) : subjectId,
      ctx,
    );
  }

  // The host's own picker browses the whole disk; a paired device must not.
  if (command === "resolve_mention_path") {
    const roots = collectAllProjects().map((p) => p.path);

    return control(() =>
      resolveMentionPath(args.id as string, args.query as string, roots),
    );
  }

  try {
    return (await invokeCommand(command, params)) ?? null;
  } catch (err) {
    // GitError rides the envelope's `data` field so the client can rehydrate
    // kind/recovery instead of parsing a message string.
    if (err instanceof GitError) {
      throw new GatewayError(
        "bad_request",
        err.message,
        serializeGitError(err),
      );
    }
    if (err instanceof CommandParamsError) {
      throw new GatewayError("bad_request", err.message, {
        issues: err.issues,
      });
    }
    // So a native client can walk the user through the fix, as the desktop does.
    if (err instanceof ShareError) {
      throw new GatewayError("bad_request", err.message, err.toPayload());
    }
    throw new GatewayError(
      "bad_request",
      err instanceof Error ? err.message : String(err),
    );
  }
}

/**
 * Dispatch a decrypted request. Enforces the capability grant, then routes to
 * the handler. Throws `GatewayError` (mapped to a wire error by the caller).
 *
 * Dotted names (`agents.spawn`) are the monitor/control allowlist; anything
 * else is a raw IPC command name and needs `admin`.
 */
export async function dispatch(
  method: string,
  params: unknown,
  ctx: GatewayContext,
): Promise<unknown> {
  if (!(method in REMOTE_METHODS)) {
    if (!ctx.scope && ctx.device.capabilities.includes("admin")) {
      return dispatchAdmin(method, params, ctx);
    }

    throw unknownMethodError("capability_denied", method);
  }
  const remoteMethod = method as RemoteMethod;
  const required = REMOTE_METHODS[remoteMethod];
  if (!hasCapability(ctx, required)) {
    throw new GatewayError(
      "capability_denied",
      `device lacks '${required}' capability`,
    );
  }
  if (!ctx.scope) {
    return HANDLERS[remoteMethod](params, ctx);
  }

  requireInScope(remoteMethod, params, ctx.scope);

  return filterForScope(
    remoteMethod,
    await HANDLERS[remoteMethod](params, ctx),
    ctx.scope,
  );
}
