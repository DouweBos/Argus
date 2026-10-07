/**
 * The host's own conversation owner, for when no UI is attached to do it: a
 * plain `argus-host`, a Linux box, the windowless server. It does what the
 * desktop renderer and the Mac app do for their agents — fold the stream into
 * a conversation, publish the snapshot the gateway serves, record the user's
 * messages, drain the queue, save chat history, title and notify.
 *
 * A UI that owns conversations claims them (`claimConversations`) and the host
 * stands down, so a snapshot only ever has one writer. When the last one lets
 * go, the host picks every live agent back up from its latest snapshot.
 */

import type { AgentInfo } from "../models";
import type {
  AgentCapabilities,
  AgentConversation,
  ConversationMessage,
  ImageAttachment,
  LlmStreamEvent,
  PermissionRequest,
} from "./types";
import { addHostEventSink } from "@argus/host/bus";
import { warn } from "@argus/host/logger";
import { appState } from "../../../state";
import { generateChatTitle } from "../../llm/titleGenerator";
import { sendAgentMessage } from "../agentService";
import { saveConversation } from "../chatHistory";
import { createCheckpoint } from "../checkpoints";
import { dequeueMessage, listQueue } from "../messageQueue";
import { getAgentSnapshot, publishAgentSnapshot } from "../snapshots";
import { parseCliDiagnostic } from "./cliDiagnostics";
import {
  isAwaitingAnswerTool,
  notifyFinished,
  notifyPrompt,
} from "./hostNotifications";
import {
  dropLive,
  flushLive,
  liveConversation,
  seedLive,
  setLive,
} from "./live";
import {
  deriveTitle,
  emptyConversation,
  reduceEvent,
  withCapabilities,
  withInjectedPrompt,
  withPermissionPending,
  withSystemMessage,
  withUserMessage,
} from "./reducer";

/**
 * Mid-turn history writes, at most this often: a long chat is megabytes. Turn
 * ends, exits and stops write at once.
 */
const SAVE_INTERVAL_MS = 10_000;
const AWAITING_ANSWER_GRACE_MS = 750;
const PERMISSION_RETRY_MS = 50;
const PERMISSION_RETRIES = 20;

interface Tracked {
  sessionId: string;
  parentAgentId: string | null;
  runnerId?: string;
  /** A message went in and no idle came back yet. */
  inflight: boolean;
  finished?: { durationMs: number; failed: boolean };
  saveTimer?: NodeJS.Timeout;
  titleRequested?: boolean;
}

const tracked = new Map<string, Tracked>();
let owners = 0;
let unsubscribe: (() => void) | null = null;

/** Whether the host itself is folding conversations right now. */
export function hostOwnsConversations(): boolean {
  return unsubscribe !== null && owners === 0;
}

/**
 * A UI that folds and publishes conversations itself is attached. Returns the
 * release; once every claim is released the host takes over again.
 */
export function claimConversations(): () => void {
  owners += 1;
  if (owners === 1) {
    standDown();
  }
  let released = false;

  return () => {
    if (released) {
      return;
    }
    released = true;
    owners -= 1;
    if (owners === 0 && unsubscribe) {
      adoptLiveAgents();
    }
  };
}

export function startHostConversations(): void {
  if (unsubscribe) {
    return;
  }
  unsubscribe = addHostEventSink((channel, args) => {
    if (!hostOwnsConversations()) {
      return;
    }
    try {
      route(channel, args[0]);
    } catch (e) {
      warn(`[conversations] ${channel}: ${String(e)}`);
    }
  });
  if (owners === 0) {
    adoptLiveAgents();
  }
}

/** Flush every pending save and stop listening. */
export function stopHostConversations(): void {
  unsubscribe?.();
  unsubscribe = null;
  standDown();
}

/** Test-only. */
export function resetHostConversations(): void {
  stopHostConversations();
  owners = 0;
}

/** Hand every conversation to the UI that claimed them, via its snapshot. */
function standDown(): void {
  for (const agentId of [...tracked.keys()]) {
    save(agentId);
    publish(agentId);
    untrack(agentId);
  }
}

function untrack(agentId: string): void {
  const entry = tracked.get(agentId);
  clearTimeout(entry?.saveTimer);
  tracked.delete(agentId);
  dropLive(agentId);
}

function adoptLiveAgents(): void {
  for (const agent of appState.agents.values()) {
    track(agent.agentId, agent.sessionId, agent.parentAgentId, agent.runner.id);
  }
}

function track(
  agentId: string,
  sessionId: string,
  parentAgentId: string | null,
  runnerId?: string,
): Tracked {
  const existing = tracked.get(agentId);
  if (existing) {
    return existing;
  }
  seedLive(agentId, seed(agentId));
  const entry: Tracked = {
    sessionId,
    parentAgentId,
    runnerId,
    inflight: appState.agents.get(agentId)?.status === "running",
  };
  tracked.set(agentId, entry);

  return entry;
}

/** Whatever was last published — a resumed chat, or a UI's that just left. */
function seed(agentId: string): AgentConversation {
  const raw = getAgentSnapshot(agentId);
  if (!raw) {
    return emptyConversation();
  }
  try {
    const conv = JSON.parse(raw) as AgentConversation;

    return Array.isArray(conv.messages) ? conv : emptyConversation();
  } catch {
    return emptyConversation();
  }
}

const AGENT_CHANNEL = /^agent:([a-z-]+):(.+)$/;

function route(channel: string, payload: unknown): void {
  if (channel === "agent:started") {
    started(payload as AgentInfo & { initial_prompt?: string });

    return;
  }
  const match = AGENT_CHANNEL.exec(channel);
  if (!match) {
    return;
  }
  const [, kind, agentId] = match;
  const entry = tracked.get(agentId!);
  if (!entry) {
    return;
  }
  const id = agentId!;
  switch (kind) {
    case "event":
      streamLine(id, entry, payload as string);
      break;
    case "status":
      statusChanged(id, entry, payload as string);
      break;
    case "exit":
      entry.inflight = false;
      save(id);
      flushLive(id);
      break;
    case "queue":
      if (appState.agents.get(id)?.status === "idle") {
        trySendNextQueued(id, entry);
      }
      break;
    case "permission":
      permissionRequested(id, entry, payload as PermissionRequest, 0);
      break;
    case "permission-cancel":
    case "permission-resolved":
      update(id, entry, (c) =>
        withPermissionPending(
          c,
          (payload as { tool_use_id: string }).tool_use_id,
          false,
        ),
      );
      break;
    case "capabilities":
      update(id, entry, (c) =>
        withCapabilities(c, payload as AgentCapabilities),
      );
      trySendNextQueued(id, entry);
      break;
    case "model-changed":
      update(id, entry, (c) => ({ ...c, model: payload as string }));
      break;
    case "mcp-message":
      injected(id, entry, payload as McpMessage);
      break;
    case "remote-message": {
      // Sent straight to the CLI by the gateway or an automation.
      const { message, images, author } = payload as RemoteMessage;
      entry.inflight = true;
      userMessage(id, entry, message, images, author ?? undefined);
      break;
    }
    case "stderr":
      stderr(id, entry, payload as string);
      break;
  }
}

interface McpMessage {
  images?: ImageAttachment[];
  message: string;
  parentAgentId?: string;
  parentLabel?: string;
  timestamp?: number;
  tool: NonNullable<ConversationMessage["source"]>["tool"];
}

interface RemoteMessage {
  author?: string | null;
  images?: ImageAttachment[];
  message: string;
}

function started(info: AgentInfo & { initial_prompt?: string }): void {
  if (!info?.agent_id) {
    return;
  }
  const entry = track(
    info.agent_id,
    info.session_id,
    info.parent_agent_id,
    info.runner_id,
  );
  if (info.capabilities) {
    update(info.agent_id, entry, (c) =>
      withCapabilities(c, info.capabilities as unknown as AgentCapabilities),
    );
  }
  if (info.initial_prompt) {
    // The prompt is already on its way to the CLI; its bubble comes from the
    // mcp/remote message that announces it.
    entry.inflight = true;
    maybeGenerateTitle(info.agent_id, entry, info.initial_prompt);
  }
}

function streamLine(agentId: string, entry: Tracked, line: string): void {
  let event: LlmStreamEvent;
  try {
    event = JSON.parse(line) as LlmStreamEvent;
  } catch {
    return;
  }
  update(agentId, entry, (c) => reduceEvent(c, event));
  if (event.type === "assistant") {
    for (const block of event.message.content ?? []) {
      if (block.type === "tool_use" && isAwaitingAnswerTool(block.name)) {
        notifyIfStillUnanswered(agentId, block.id, block.name);
      }
    }
  }
  // A result isn't the agent going idle; hold it until the turn ends.
  if (event.type === "result") {
    entry.finished = {
      durationMs: event.duration_ms,
      failed: event.subtype === "error",
    };
  }
}

function statusChanged(agentId: string, entry: Tracked, status: string): void {
  if (status === "running" || status === "requires_action") {
    return;
  }
  if (status === "stopped" || status === "error") {
    entry.inflight = false;
    save(agentId);
    untrack(agentId);

    return;
  }
  if (status !== "idle") {
    return;
  }
  entry.inflight = false;
  save(agentId);
  const finished = entry.finished;
  entry.finished = undefined;
  if (trySendNextQueued(agentId, entry)) {
    return;
  }
  if (finished) {
    notifyFinished(
      agentId,
      entry.sessionId,
      conversationOf(agentId).title,
      finished.durationMs,
      finished.failed,
    );
  }
}

function permissionRequested(
  agentId: string,
  entry: Tracked,
  request: PermissionRequest,
  attempt: number,
): void {
  if (attempt === 0) {
    notifyPrompt(
      agentId,
      entry.sessionId,
      conversationOf(agentId).title,
      request.tool_use_id,
      request.tool_name,
      true,
    );
  }
  const next = withPermissionPending(
    conversationOf(agentId),
    request.tool_use_id,
    true,
  );
  if (next) {
    update(agentId, entry, () => next);

    return;
  }
  // The tool call may not be folded in yet (a nested subagent call).
  if (attempt < PERMISSION_RETRIES) {
    setTimeout(() => {
      if (tracked.get(agentId) === entry) {
        permissionRequested(agentId, entry, request, attempt + 1);
      }
    }, PERMISSION_RETRY_MS);
  }
}

function notifyIfStillUnanswered(
  agentId: string,
  toolUseId: string,
  toolName: string,
): void {
  setTimeout(() => {
    const entry = tracked.get(agentId);
    if (!entry) {
      return;
    }
    const answered = conversationOf(agentId).messages.some((m) =>
      m.toolCalls.some((tc) => tc.id === toolUseId && tc.result !== undefined),
    );
    if (!answered) {
      notifyPrompt(
        agentId,
        entry.sessionId,
        conversationOf(agentId).title,
        toolUseId,
        toolName,
        false,
      );
    }
  }, AWAITING_ANSWER_GRACE_MS);
}

function injected(agentId: string, entry: Tracked, payload: McpMessage): void {
  update(agentId, entry, (c) =>
    withInjectedPrompt(c, {
      id: crypto.randomUUID(),
      role: "system",
      textBlocks: [payload.message],
      toolCalls: [],
      images: payload.images?.length ? payload.images : undefined,
      timestamp: payload.timestamp ?? Date.now(),
      source: {
        kind: "mcp",
        tool: payload.tool,
        parentAgentId: payload.parentAgentId,
        parentLabel: payload.parentLabel,
      },
    }),
  );
}

function userMessage(
  agentId: string,
  entry: Tracked,
  text: string,
  images?: ImageAttachment[],
  author?: string,
  checkpointId?: string,
): void {
  update(agentId, entry, (c) =>
    withUserMessage(c, text, { images, author, checkpointId }),
  );
  maybeGenerateTitle(agentId, entry, text);
}

function stderr(agentId: string, entry: Tracked, line: string): void {
  if (!line) {
    return;
  }
  const diagnostic = parseCliDiagnostic(line);
  update(agentId, entry, (c) =>
    withSystemMessage(c, {
      id: crypto.randomUUID(),
      role: "system",
      tone: diagnostic ? "warning" : "error",
      textBlocks: diagnostic
        ? [diagnostic.title, ...diagnostic.details]
        : [line],
      toolCalls: [],
      timestamp: Date.now(),
    }),
  );
}

/**
 * Send the next queued message, if the agent has nothing in flight. Claims
 * `inflight` before anything awaits, so overlapping idle and capability
 * signals can't dispatch two messages into one turn.
 */
function trySendNextQueued(agentId: string, entry: Tracked): boolean {
  if (entry.inflight || listQueue(agentId).length === 0) {
    return false;
  }
  const next = dequeueMessage(agentId);
  if (!next) {
    return false;
  }
  entry.inflight = true;
  (async () => {
    let checkpointId: string | undefined;
    try {
      checkpointId = (await createCheckpoint(entry.sessionId)).id;
    } catch {
      // A checkpoint is a nicety; the send goes ahead without one.
    }
    if (tracked.get(agentId) !== entry) {
      return;
    }
    userMessage(
      agentId,
      entry,
      next.display_text ?? next.text,
      next.images,
      next.author,
      checkpointId,
    );
    try {
      sendAgentMessage(agentId, next.text, next.images);
    } catch (e) {
      entry.inflight = false;
      warn(`[conversations] queued send to ${agentId} failed: ${String(e)}`);
    }
  })().catch(() => undefined);

  return true;
}

function maybeGenerateTitle(
  agentId: string,
  entry: Tracked,
  firstMessage: string,
): void {
  if (entry.titleRequested || conversationOf(agentId).title) {
    entry.titleRequested = true;

    return;
  }
  const text = firstMessage.trim();
  if (!text) {
    return;
  }
  entry.titleRequested = true;
  generateChatTitle(text)
    .then((title) => {
      if (
        title &&
        tracked.get(agentId) === entry &&
        !conversationOf(agentId).title
      ) {
        update(agentId, entry, (c) => ({ ...c, title }));
      }
    })
    .catch(() => {
      entry.titleRequested = false;
    });
}

function conversationOf(agentId: string): AgentConversation {
  return liveConversation(agentId) ?? emptyConversation();
}

function update(
  agentId: string,
  entry: Tracked,
  fn: (c: AgentConversation) => AgentConversation | null,
): void {
  const current = liveConversation(agentId);
  if (!current) {
    return;
  }
  const next = fn(current);
  if (!next || next === current) {
    return;
  }
  setLive(agentId, next);
  entry.saveTimer ??= setTimeout(() => {
    entry.saveTimer = undefined;
    save(agentId);
  }, SAVE_INTERVAL_MS);
}

/** Leave the conversation where a UI that claims it next will look. */
function publish(agentId: string): void {
  const conv = liveConversation(agentId);
  if (!conv || !appState.agents.has(agentId)) {
    return;
  }
  try {
    publishAgentSnapshot(agentId, JSON.stringify(conv));
  } catch (e) {
    warn(`[conversations] snapshot for ${agentId} failed: ${String(e)}`);
  }
}

/** Upserts by the CLI session id, so repeat saves overwrite one record. */
function save(agentId: string): void {
  const entry = tracked.get(agentId);
  const conv = liveConversation(agentId);
  if (!entry || !conv) {
    return;
  }
  clearTimeout(entry.saveTimer);
  entry.saveTimer = undefined;
  const session = appState.sessions.get(entry.sessionId);
  if (!conv.sessionId || conv.messages.length === 0 || !session) {
    return;
  }
  try {
    saveConversation(session.repo_root, {
      id: crypto.randomUUID(),
      sessionId: conv.sessionId,
      agentId,
      parentAgentId: entry.parentAgentId ?? undefined,
      argusSessionId: entry.sessionId,
      title: conv.title ?? deriveTitle(conv.messages),
      sessionBranch: session.branch ?? "",
      sessionDescription: session.description ?? "",
      model: conv.model,
      runnerId: entry.runnerId,
      totalCost: conv.totalCost,
      totalDuration: conv.totalDuration,
      messageCount: conv.messages.length,
      createdAt: conv.messages[0]?.timestamp ?? Date.now(),
      endedAt: Date.now(),
      messages: conv.messages,
    });
  } catch (e) {
    warn(`[conversations] saving ${agentId} failed: ${String(e)}`);
  }
}
