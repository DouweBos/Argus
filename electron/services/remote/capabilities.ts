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
  type RemoteAgentCapabilities,
  type RemoteAgentStatus,
  type RemoteGitStatus,
  type RemoteMessage,
  type RemoteDevice,
  type RemoteMethod,
  type RemotePlatform,
  type RemoteSession,
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
import { listSessionFiles, resolveMentionPath } from "../file/operations";
import { collectAllProjects } from "../mcp/projects";
import { listOrganizations } from "../organization/manager";
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
import { renameDevice, type PairedDevice } from "./deviceStore";

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
  /** `agentId::toolUseId` prompts this device was forwarded and may answer. */
  outstandingPermissions: Set<string>;
  /** Screen-stream control, present when the transport carries a media channel. */
  media?: DeviceMediaController;
}

export function permissionKey(agentId: string, toolUseId: string): string {
  return `${agentId}::${toolUseId}`;
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
  if (s.kind === "org_host") {
    return s.display_name ?? "Organization";
  }

  return s.display_name ?? s.branch;
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

export function toRemoteAgentStatus(a: AgentSession): RemoteAgentStatus {
  return {
    agent_id: a.agentId,
    session_id: a.sessionId,
    session_label: sessionLabel(a.sessionId),
    title: agentTitle(a.agentId),
    status: a.status,
    model: a.model,
    permission_mode: a.permissionMode ?? null,
    parent_agent_id: a.parentAgentId,
    created_at: a.createdAt,
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
    const raw = conv.messages ?? [];
    const total = raw.length;
    const size = limit ?? 100;
    // `before` → the page ending there (older history); `after` → forward from
    // there; neither → the tail (most-recent page), so a fresh open lands at the
    // newest messages and lazy-loads older ones on scroll-up.
    let start: number;
    let end: number;
    if (before != null) {
      end = Math.min(before, total);
      start = Math.max(0, end - size);
    } else if (after != null) {
      start = after;
      end = Math.min(total, start + size);
    } else {
      start = Math.max(0, total - size);
      end = total;
    }
    const messages = raw.slice(start, end).map(toRemoteMessage);

    return {
      messages,
      next_after: end < total ? end : null,
      prev_before: start > 0 ? start : null,
      total,
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

  "orgs.list": async () => {
    const organizations = listOrganizations().map((o) => ({
      id: o.id,
      name: o.name,
      accent: o.accent,
      member_repo_roots: o.members.map((m) => m.repo_root),
    }));

    return { organizations };
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
    await control(() => setAgentPermissionMode(agent_id, mode));

    return { accepted: true };
  },

  "agents.set_effort": async (params) => {
    const { agent_id, level } = parse("agents.set_effort", params);
    await control(() => setAgentEffort(agent_id, level));

    return { accepted: true };
  },

  "agents.spawn": async (params) => {
    const { session_id, model, permission_mode } = parse(
      "agents.spawn",
      params,
    );
    const info = await control(() =>
      startAgent(session_id, model, permission_mode),
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

    return { accepted: true };
  },
  "devices.touch": async (params) => {
    const { device_id, platform, x, y, event_type } = parse(
      "devices.touch",
      params,
    );
    await control(() =>
      platform === "ios"
        ? simulatorTouch(device_id, x, y, event_type)
        : androidTouch(device_id, x, y, event_type),
    );

    return { accepted: true };
  },
  "devices.button": async (params) => {
    const { device_id, platform, button } = parse("devices.button", params);
    await control(() =>
      platform === "ios"
        ? simulatorButton(device_id, button)
        : androidButton(button),
    );

    return { accepted: true };
  },
  "devices.keyboard": async (params) => {
    const { device_id, platform, key_code, modifiers, is_down } = parse(
      "devices.keyboard",
      params,
    );
    await control(() =>
      platform === "ios"
        ? simulatorKeyboard(device_id, key_code, modifiers, is_down)
        : androidKeyboard(key_code, modifiers, is_down),
    );

    return { accepted: true };
  },
};

/**
 * Dispatch a decrypted request. Enforces the capability grant, then routes to
 * the handler. Throws `GatewayError` (mapped to a wire error by the caller).
 */
export async function dispatch(
  method: string,
  params: unknown,
  ctx: GatewayContext,
): Promise<unknown> {
  if (!(method in REMOTE_METHODS)) {
    throw new GatewayError("capability_denied", `unknown method ${method}`);
  }
  const required = REMOTE_METHODS[method as RemoteMethod];
  if (!ctx.device.capabilities.includes(required)) {
    throw new GatewayError(
      "capability_denied",
      `device lacks '${required}' capability`,
    );
  }

  return HANDLERS[method as RemoteMethod](params, ctx);
}
