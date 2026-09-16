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
import type { z } from "zod";
import {
  MethodParams,
  REMOTE_METHODS,
  isHostOnlyCommand,
  type Capability,
  type RemoteAgentCapabilities,
  type RemoteAgentStatus,
  type RemoteGitStatus,
  type RemoteMessage,
  type RemoteDevice,
  type RemoteGitBranch,
  type RemoteMethod,
  type RemotePlatform,
  type RemoteSession,
  type RemoteStoppedAgent,
  type RemoteTask,
  type RemoteToolCall,
  type RemoteToolCallChild,
  type RemoteToolResultBlock,
  type RemoteTodo,
} from "@argus/remote-protocol";
import { broadcastToRenderers } from "../../broadcast";
import { appState } from "../../state";
import {
  interruptAgent,
  respondToPermission,
  sendAgentMessage,
  setAgentEffort,
  setAgentModel,
  setAgentPermissionMode,
  startAgent,
  stopAgent,
} from "../agent/agentService";
import { loadConversation, loadHistoryIndex } from "../agent/chatHistory";
import {
  enqueueMessage,
  listQueue,
  removeQueuedMessage,
  updateQueuedMessage,
} from "../agent/messageQueue";
import { listSessionFiles, resolveMentionPath } from "../file/operations";
import { collectAllProjects } from "../mcp/projects";
import {
  gitCheckout,
  gitCreateBranch,
  gitDeleteBranch,
  gitDiscardAndCheckout,
  gitListLocalBranches,
  gitListRemoteBranches,
  gitStashAndCheckout,
} from "../session/gitBranchOps";
import { GitError } from "../session/gitError";
import { gitStatus } from "../session/gitStatus";
import {
  createSession,
  deleteSession,
  listSessions,
  renameSession,
  renameSessionBranch,
} from "../session/manager";
import {
  getSessionBranchDiff,
  getSessionFullDiff,
} from "../session/sessionOps";
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
  listSimulators,
  simulatorButton,
  simulatorKeyboard,
  simulatorTouch,
} from "../simulator/ios";
import { getVideoDims } from "../simulator/videoForward";
import {
  claimDevice,
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
import { hasHostCommand, invokeHostCommand } from "./ipcPassthrough";
import {
  ensureVapidPublicKey,
  getPushConfigStatus,
  isPushConfigured,
} from "./push/config";

export class GatewayError extends Error {
  constructor(
    readonly code:
      | "bad_request"
      | "capability_denied"
      | "internal"
      | "not_found",
    message: string,
  ) {
    super(message);
    this.name = "GatewayError";
  }
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
 */
function requireDeviceInput(deviceId: string, ctx: GatewayContext): void {
  const result = claimDevice(deviceId, claimHolder(ctx));
  if (!result.granted) {
    throw new GatewayError(
      "capability_denied",
      `device is being controlled by ${result.holder?.label ?? "another client"}`,
    );
  }
}

/** Map a booted iOS simulator to the remote device shape. */
function iosToRemoteDevice(d: {
  udid: string;
  name: string;
  runtime: string;
  booted: boolean;
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
    status: sessionStatus(s.status),
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
  const repoRoot = appState.sessions.get(sessionId)?.repo_root;

  return repoRoot ? (repoRoot.split("/").pop() ?? repoRoot) : undefined;
}

/** The agent's generated conversation title, read from its published snapshot. */
function agentTitle(agentId: string): string | null {
  const snapshot = appState.agentSnapshots.get(agentId);
  if (!snapshot) {
    return null;
  }
  try {
    const title = (JSON.parse(snapshot) as { title?: string }).title;

    return title && title.trim() ? title : null;
  } catch {
    return null;
  }
}

/**
 * What an agent is blocked on the user for. Permission prompts are tracked
 * host-side; questions and plan approvals never raise one in auto-approving
 * modes, so those come from the unresolved tool call in the snapshot.
 */
function agentAwaiting(agentId: string): RemoteAgentStatus["awaiting"] {
  const pending = appState.agentPendingPermissions.get(agentId);
  const prompt = pending ? [...pending.values()][0] : undefined;
  if (prompt) {
    return awaitingForTool(prompt.tool_name) ?? "permission";
  }

  const snapshot = appState.agentSnapshots.get(agentId);
  if (!snapshot) {
    return null;
  }
  try {
    const conv = JSON.parse(snapshot) as RawConversation;
    for (const message of (conv.messages ?? []).slice(-3).reverse()) {
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
    // Corrupt snapshot — treat as nothing pending.
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
    permission_mode: a.permissionMode ?? null,
    parent_agent_id: a.parentAgentId,
    created_at: a.createdAt,
    last_activity_at: a.lastEventAt,
    awaiting: agentAwaiting(a.agentId),
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

// --- Transcript mapping (ConversationMessage → RemoteMessage) --------------

/**
 * Raw snapshot shapes — the JSON the renderer publishes via
 * `publishAgentSnapshot` (camelCase mirror of `AgentConversation`). Deliberately
 * loose: fields we don't forward are omitted.
 */
type RawResultBlock =
  | {
      type: "image";
      source: { data: string; media_type: string; type: string };
    }
  | { type: "text"; text: string };
interface RawToolCall {
  id?: string;
  name?: string;
  input?: Record<string, unknown>;
  result?: RawResultBlock[] | string;
  isError?: boolean;
  pendingPermission?: boolean;
  children?: RawChild[];
}
type RawChild =
  | { kind: "text"; text: string }
  | { kind: "tool_use"; toolCall: RawToolCall };
interface RawImage {
  data: string;
  media_type: string;
}
interface RawSource {
  kind?: string;
  tool?: string;
  parentAgentId?: string;
  parentLabel?: string;
}
interface RawTokenUsage {
  input_tokens?: number;
  output_tokens?: number;
  cache_read_input_tokens?: number;
  cache_creation_input_tokens?: number;
}
interface RawMessage {
  id?: string;
  role?: string;
  textBlocks?: string[];
  toolCalls?: RawToolCall[];
  images?: RawImage[];
  source?: RawSource;
  isError?: boolean;
  timestamp?: number;
  usage?: RawTokenUsage;
}
interface RawTask {
  id?: string;
  subject?: string;
  status?: string;
  description?: string;
  activeForm?: string;
  owner?: string;
  blocks?: string[];
  blockedBy?: string[];
}
interface RawTodo {
  content?: string;
  status?: string;
  activeForm?: string;
}
interface RawConversation {
  messages?: RawMessage[];
  tasks?: Record<string, RawTask> | null;
  taskOrder?: string[];
  todos?: RawTodo[] | null;
  model?: string | null;
  pendingToolName?: string | null;
  title?: string;
}

/**
 * Stable image id for a result/attachment block. `slot` is the owning tool's
 * id, or "msg" for message-level attachments. Ids are recomputed on demand by
 * `agents.image` from the same snapshot, so they need no server-side storage.
 */
function imageId(messageId: string, slot: string, blockIndex: number): string {
  return `${messageId}:${slot}:${blockIndex}`;
}

function resultBlocks(
  messageId: string,
  toolUseId: string,
  result: RawToolCall["result"],
): RemoteToolResultBlock[] {
  if (result == null) {
    return [];
  }
  if (typeof result === "string") {
    return result ? [{ type: "text", text: result }] : [];
  }

  return result.map((block, i): RemoteToolResultBlock => {
    if (block.type === "image") {
      return {
        type: "image",
        image_id: imageId(messageId, toolUseId, i),
        media_type: block.source.media_type,
      };
    }
    if (block.type === "text") {
      return { type: "text", text: block.text };
    }

    return { type: "text", text: JSON.stringify(block) };
  });
}

function toolStatus(tc: RawToolCall): RemoteToolCall["status"] {
  if (tc.pendingPermission) {
    return "pending";
  }
  if (tc.isError) {
    return "error";
  }

  return tc.result != null ? "done" : "running";
}

function toRemoteToolCall(messageId: string, tc: RawToolCall): RemoteToolCall {
  const id = tc.id ?? "";
  const status = toolStatus(tc);
  const children = tc.children?.map(
    (c): RemoteToolCallChild =>
      c.kind === "text"
        ? { kind: "text", text: c.text }
        : {
            kind: "tool_use",
            tool_call: toRemoteToolCall(messageId, c.toolCall),
          },
  );

  return {
    id,
    name: tc.name ?? "tool",
    input: tc.input ?? {},
    result_blocks: resultBlocks(messageId, id, tc.result),
    ...(children && children.length > 0 ? { children } : {}),
    ...(tc.pendingPermission ? { pending_permission: true } : {}),
    ...(tc.isError ? { is_error: true } : {}),
    status,
  };
}

function toRemoteMessage(m: RawMessage): RemoteMessage {
  const messageId = m.id ?? "";
  const role = m.role === "user" || m.role === "system" ? m.role : "assistant";
  const images = (m.images ?? []).map((img, i) => ({
    image_id: imageId(messageId, "msg", i),
    media_type: img.media_type,
  }));
  const source =
    m.source?.kind === "mcp" && m.source.tool
      ? {
          kind: "mcp" as const,
          tool: m.source.tool,
          parent_agent_id: m.source.parentAgentId ?? null,
          parent_label: m.source.parentLabel ?? null,
        }
      : undefined;

  return {
    id: messageId,
    role,
    text_blocks: (m.textBlocks ?? []).filter((t) => t.trim().length > 0),
    tool_calls: (m.toolCalls ?? []).map((tc) =>
      toRemoteToolCall(messageId, tc),
    ),
    ...(images.length > 0 ? { images } : {}),
    ...(source ? { source } : {}),
    ...(m.usage && typeof m.usage.input_tokens === "number"
      ? {
          usage: {
            input_tokens: m.usage.input_tokens,
            output_tokens: m.usage.output_tokens ?? 0,
            cache_read_input_tokens: m.usage.cache_read_input_tokens,
            cache_creation_input_tokens: m.usage.cache_creation_input_tokens,
          },
        }
      : {}),
    is_error: m.isError,
    timestamp: m.timestamp,
  };
}

/** Ordered task list from the snapshot's tasks map + taskOrder. */
function toRemoteTasks(conv: RawConversation): RemoteTask[] | null {
  if (!conv.tasks) {
    return null;
  }
  const order =
    conv.taskOrder && conv.taskOrder.length > 0
      ? conv.taskOrder
      : Object.keys(conv.tasks);
  const tasks: RemoteTask[] = [];
  for (const id of order) {
    const t = conv.tasks[id];
    if (!t || !t.subject) {
      continue;
    }
    const status =
      t.status === "completed" || t.status === "in_progress"
        ? t.status
        : "pending";
    tasks.push({
      id: t.id ?? id,
      subject: t.subject,
      status,
      description: t.description,
      activeForm: t.activeForm,
      owner: t.owner,
      blocks: t.blocks,
      blockedBy: t.blockedBy,
    });
  }

  return tasks;
}

function toRemoteTodos(conv: RawConversation): RemoteTodo[] | null {
  if (!conv.todos) {
    return null;
  }

  return conv.todos
    .filter((t): t is RawTodo & { content: string } => !!t.content)
    .map((t) => ({
      content: t.content,
      status:
        t.status === "completed" || t.status === "in_progress"
          ? t.status
          : "pending",
      activeForm: t.activeForm,
    }));
}

/**
 * Re-walk a snapshot minting the same image ids as `toRemoteMessage`, so
 * `agents.image` can resolve an id → its base64 bytes without server state.
 */
function findImage(
  conv: RawConversation,
  wanted: string,
): { data: string; media_type: string } | null {
  type Found = { data: string; media_type: string } | null;
  const walkTool = (messageId: string, tc: RawToolCall): Found => {
    let result: Found = null;
    const id = tc.id ?? "";
    if (Array.isArray(tc.result)) {
      tc.result.forEach((block, i) => {
        if (block.type === "image" && imageId(messageId, id, i) === wanted) {
          result = {
            data: block.source.data,
            media_type: block.source.media_type,
          };
        }
      });
    }
    if (!result && tc.children) {
      for (const c of tc.children) {
        if (c.kind === "tool_use") {
          result = walkTool(messageId, c.toolCall);
          if (result) {
            break;
          }
        }
      }
    }

    return result;
  };

  for (const m of conv.messages ?? []) {
    const messageId = m.id ?? "";
    const images = m.images ?? [];
    const msgImage = images.findIndex(
      (_img, i) => imageId(messageId, "msg", i) === wanted,
    );
    if (msgImage !== -1) {
      const img = images[msgImage];

      return { data: img.data, media_type: img.media_type };
    }
    for (const tc of m.toolCalls ?? []) {
      const found = walkTool(messageId, tc);
      if (found) {
        return found;
      }
    }
  }

  return null;
}

/** Parse an agent's published snapshot JSON, or throw a gateway error. */
function parseSnapshot(agentId: string): RawConversation {
  const snapshotJson = appState.agentSnapshots.get(agentId);
  if (!snapshotJson) {
    throw new GatewayError("not_found", `no transcript for ${agentId}`);
  }
  try {
    return JSON.parse(snapshotJson) as RawConversation;
  } catch {
    throw new GatewayError("internal", "corrupt transcript snapshot");
  }
}

/**
 * Read a stopped agent's conversation back off disk. Its live snapshot is gone
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

/**
 * Slice a transcript into a page. `before` → the page ending there (older
 * history); `after` → forward from there; neither → the tail, so a fresh open
 * lands at the newest messages and lazy-loads older ones on scroll-up.
 */
function transcriptPage(
  conv: RawConversation,
  cursor: { after?: number; before?: number; limit?: number },
): {
  messages: RemoteMessage[];
  next_after: number | null;
  prev_before: number | null;
  total: number;
} {
  const raw = conv.messages ?? [];
  const total = raw.length;
  const size = cursor.limit ?? 100;
  let start: number;
  let end: number;
  if (cursor.before != null) {
    end = Math.min(cursor.before, total);
    start = Math.max(0, end - size);
  } else if (cursor.after != null) {
    start = cursor.after;
    end = Math.min(total, start + size);
  } else {
    start = Math.max(0, total - size);
    end = total;
  }

  return {
    messages: raw.slice(start, end).map(toRemoteMessage),
    next_after: end < total ? end : null,
    prev_before: start > 0 ? start : null,
    total,
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

/** Look up a live agent or throw a gateway not_found. */
function requireAgent(agentId: string): AgentSession {
  const agent = appState.agents.get(agentId);
  if (!agent) {
    throw new GatewayError("not_found", `no agent ${agentId}`);
  }

  return agent;
}

/** Ensure a session exists or throw a gateway not_found. */
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
 * Belt-and-braces rejection of "trusted" (bypassPermissions). The wire schema
 * already excludes it, but an unattended host auto-approving every tool call is
 * the one failure worth checking twice.
 */
function requireRemotePermissionMode(mode: string | undefined): void {
  if (mode && !["ask", "auto", "plan", "review"].includes(mode)) {
    throw new GatewayError("capability_denied", `permission mode ${mode}`);
  }
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
    const conv = parseSnapshot(agent_id);

    return {
      ...transcriptPage(conv, { after, before, limit }),
      tasks: toRemoteTasks(conv),
      todos: toRemoteTodos(conv),
      model: conv.model ?? null,
      pending_tool_name: conv.pendingToolName ?? null,
    };
  },

  "agents.image": async (params) => {
    const { agent_id, image_id } = parse("agents.image", params);
    const conv = parseSnapshot(agent_id);
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
    const agents = loadHistoryIndex(repo_root)
      .filter((e) => !e.agentId || !appState.agents.has(e.agentId))
      .slice(0, limit ?? 20)
      .map(
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
        }),
      );

    return { agents };
  },

  "agents.stopped_transcript": async (params) => {
    const { repo_root, history_id, after, before, limit } = parse(
      "agents.stopped_transcript",
      params,
    );
    requireKnownRepoRoot(repo_root);
    const conv = loadStoppedConversation(repo_root, history_id);

    return {
      ...transcriptPage(conv, { after, before, limit }),
      model: conv.model ?? null,
    };
  },

  "agents.stopped_image": async (params) => {
    const { repo_root, history_id, image_id } = parse(
      "agents.stopped_image",
      params,
    );
    requireKnownRepoRoot(repo_root);
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

  "agents.send": async (params) => {
    const { agent_id, message, images } = parse("agents.send", params);
    requireAgent(agent_id);
    await control(() => sendAgentMessage(agent_id, message, images));
    // The desktop renderer records the user bubble only for sends it initiates;
    // mirror this remote send so the prompt (not just the response) shows and
    // lands in the published snapshot the web client reads back.
    broadcastToRenderers(`agent:remote-message:${agent_id}`, {
      message,
      images,
    });

    return { accepted: true };
  },

  "agents.interrupt": async (params) => {
    const { agent_id } = parse("agents.interrupt", params);
    requireAgent(agent_id);
    await control(() => interruptAgent(agent_id));

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
    const { session_id, model, permission_mode, resume_session_id } = parse(
      "agents.spawn",
      params,
    );
    requireRemotePermissionMode(permission_mode);
    const info = await control(() =>
      startAgent(session_id, model, permission_mode, resume_session_id),
    );
    // Announce the agent exactly like the start_agent IPC does — the desktop
    // renderer listens for this to track the agent, subscribe to its event
    // stream, and publish the transcript snapshots the remote monitor reads.
    // Without it the agent is a backend-only "ghost": never shown on the
    // desktop and producing no snapshot for us to read back.
    broadcastToRenderers("agent:started", info);
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

  "agents.queue_add": async (params) => {
    const { agent_id, message, display_text, images } = parse(
      "agents.queue_add",
      params,
    );
    requireAgent(agent_id);
    const queued = await control(() =>
      enqueueMessage(agent_id, {
        text: message,
        displayText: display_text,
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

  "sessions.create": async (params) => {
    const { repo_root, branch, description, use_existing_branch, base_branch } =
      parse("sessions.create", params);
    requireKnownRepoRoot(repo_root);
    const session = await control(() =>
      createSession(
        repo_root,
        branch,
        description,
        use_existing_branch,
        base_branch,
      ),
    );

    return { session: toRemoteSession(session) };
  },

  "sessions.files": async (params) => {
    const { session_id } = parse("sessions.files", params);
    const files = await control(() => listSessionFiles(session_id));

    return { files };
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
    const branches: RemoteGitBranch[] = [
      ...local.map((b) => ({
        name: b.name,
        scope: "local" as const,
        is_current: b.isCurrent,
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
  "devices.list": async () => {
    // A missing toolchain (no Xcode / no Android SDK) contributes an empty
    // list rather than failing the whole call.
    const [ios, android] = await Promise.all([
      listSimulators().catch(() => []),
      listAndroidDevices().catch(() => []),
    ]);
    const devices: RemoteDevice[] = [
      ...ios.filter((d) => d.booted).map(iosToRemoteDevice),
      ...android.filter((d) => d.online).map(androidToRemoteDevice),
    ];

    return { devices };
  },
  "devices.watch": async (params, ctx) => {
    const { device_id, platform } = parse("devices.watch", params);
    if (!ctx.media) {
      throw new GatewayError("internal", "media channel unavailable");
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
};

/**
 * Gateway-local methods: the device claim arbitrates between connected clients
 * instead of calling the service layer, so it dispatches here rather than from
 * `REMOTE_METHODS` — the shared schemas below are the same ones a client
 * compiles against. Gated on `control`, same as the HID injection it guards.
 */
const LOCAL_HANDLERS: Record<string, Handler> = {
  "devices.claim": async (params, ctx) => {
    const { device_id, force } = MethodParams["devices.claim"].parse(params);

    return claimDevice(device_id, claimHolder(ctx), force ?? false);
  },
  "devices.release": async (params, ctx) => {
    const { device_id } = MethodParams["devices.release"].parse(params);
    releaseDevice(device_id, ctx.connectionId);

    return { accepted: true };
  },
  "devices.claim_status": async (params) => {
    const { device_id } = MethodParams["devices.claim_status"].parse(params);

    return { holder: getClaim(device_id) };
  },
};

/** Admin implies the narrower tiers — it is a superset, not a sibling. */
function hasCapability(ctx: GatewayContext, required: Capability): boolean {
  return (
    ctx.device.capabilities.includes(required) ||
    ctx.device.capabilities.includes("admin")
  );
}

/**
 * Run a raw `ipcMain.handle` command on behalf of an admin device — the same
 * command the host's own renderer would invoke. Bounded only by
 * `HOST_ONLY_COMMANDS`; see §3.1 of the server-architecture plan for why this
 * tier inverts to a denylist.
 */
async function dispatchAdmin(
  command: string,
  params: unknown,
): Promise<unknown> {
  if (isHostOnlyCommand(command)) {
    throw new GatewayError("capability_denied", `host-only command ${command}`);
  }
  if (!hasHostCommand(command)) {
    throw new GatewayError("not_found", `unknown command ${command}`);
  }
  try {
    return (await invokeHostCommand(command, params)) ?? null;
  } catch (err) {
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
 * Dotted names (`agents.spawn`) are the monitor/control allowlist, plus the
 * gateway-local claim methods; anything else is a raw IPC command name and
 * needs `admin`.
 */
export async function dispatch(
  method: string,
  params: unknown,
  ctx: GatewayContext,
): Promise<unknown> {
  if (Object.hasOwn(LOCAL_HANDLERS, method)) {
    if (!hasCapability(ctx, "control")) {
      throw new GatewayError(
        "capability_denied",
        "device lacks 'control' capability",
      );
    }
    try {
      return await LOCAL_HANDLERS[method](params, ctx);
    } catch (err) {
      if (err instanceof GatewayError) {
        throw err;
      }
      throw new GatewayError("bad_request", `invalid params for ${method}`);
    }
  }
  if (!(method in REMOTE_METHODS)) {
    if (ctx.device.capabilities.includes("admin")) {
      return dispatchAdmin(method, params);
    }

    throw new GatewayError("capability_denied", `unknown method ${method}`);
  }
  const required = REMOTE_METHODS[method as RemoteMethod];
  if (!hasCapability(ctx, required)) {
    throw new GatewayError(
      "capability_denied",
      `device lacks '${required}' capability`,
    );
  }

  return HANDLERS[method as RemoteMethod](params, ctx);
}
