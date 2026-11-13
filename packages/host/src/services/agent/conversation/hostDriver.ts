/**
 * The one owner of every agent's conversation: it folds the stream, records
 * the user's messages, drains the queue, saves chat history, titles and
 * notifies. Clients only view it — a page from `./live`, then its deltas.
 */

import type { AgentInfo } from "../models";
import type {
  AgentCapabilities,
  ConversationMessage,
  ImageAttachment,
  LlmStreamEvent,
  PermissionRequest,
} from "./types";
import { addHostEventSink } from "@argus/host/bus";
import { warn } from "@argus/host/logger";
import { appState } from "../../../state";
import { capture as telemetryCapture } from "../../telemetry/telemetry";
import { sendAgentMessage } from "../agentService";
import { createCheckpoint, recordTurnEnd } from "../checkpoints";
import {
  dequeueMessage,
  listQueue,
  promoteQueuedMessage,
} from "../messageQueue";
import { runnerCommandFor } from "../runnerCommand";
import { withBackgroundSettled } from "./background";
import { parseCliDiagnostic } from "./cliDiagnostics";
import {
  conversationOf,
  maybeGenerateTitle,
  save,
  type Tracked,
  track,
  trackedAgentIds,
  trackedEntry,
  untrack,
  update,
  userMessage,
} from "./folded";
import { clearFollowUps, suggestFollowUps } from "./followUps";
import { notifyFinished, notifyPrompt } from "./hostNotifications";
import { flushLive } from "./live";
import { isAwaitingAnswerTool, withPromptsExpired } from "./prompts";
import {
  reduceEvent,
  withCapabilities,
  withInjectedPrompt,
  withPermissionPending,
  withSystemMessage,
} from "./reducer";

const AWAITING_ANSWER_GRACE_MS = 750;
const PERMISSION_RETRY_MS = 50;
const PERMISSION_RETRIES = 20;

let unsubscribe: (() => void) | null = null;

export function startHostConversations(): void {
  if (unsubscribe) {
    return;
  }
  unsubscribe = addHostEventSink((channel, args) => {
    try {
      route(channel, args[0]);
    } catch (e) {
      warn(`[conversations] ${channel}: ${String(e)}`);
    }
  });
  for (const agent of appState.agents.values()) {
    track(agent.agentId, agent.sessionId, agent.parentAgentId, agent.runner.id);
  }
}

/** Save every conversation and stop listening. */
export function stopHostConversations(): void {
  unsubscribe?.();
  unsubscribe = null;
  for (const agentId of trackedAgentIds()) {
    save(agentId);
    untrack(agentId);
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
  const entry = trackedEntry(agentId!);
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
      flushStderr(id, entry, payload as number);
      update(id, entry, (c) =>
        withPromptsExpired(withBackgroundSettled(c, Date.now())),
      );
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
      const { message, images, author, sent } = payload as RemoteMessage;
      entry.inflight = true;
      userMessage(id, entry, message, {
        images,
        author: author ?? undefined,
        sent: sent ?? undefined,
      });
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
  /** What went to the agent, when `message` is only what the bubble shows. */
  sent?: string | null;
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
    // The turn is over, so a prompt in it the runner isn't holding never gets an answer.
    const live = appState.agentPendingPermissions.get(agentId);
    update(agentId, entry, (c) =>
      withPromptsExpired(c, {
        live: (id) => live?.has(id) ?? false,
        topLevelOnly: true,
      }),
    );
    entry.finished = {
      durationMs: event.duration_ms,
      failed: event.subtype === "error",
    };
  }
}

function statusChanged(agentId: string, entry: Tracked, status: string): void {
  if (status === "running") {
    clearFollowUps(agentId, entry);

    return;
  }
  if (status === "requires_action") {
    return;
  }
  if (status === "stopped" || status === "error") {
    pinTurnEnd(agentId, entry);
    entry.inflight = false;
    update(agentId, entry, (c) =>
      withPromptsExpired(withBackgroundSettled(c, Date.now())),
    );
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
  // A queued message's checkpoint marks this turn's end itself.
  if (listQueue(agentId).length === 0) {
    pinTurnEnd(agentId, entry);
  }
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
    if (!finished.failed) {
      suggestFollowUps(agentId, entry);
    }
  }
}

/** Snapshot the tree as the end of the agent's latest turn, for turn-scoped diffs. */
function pinTurnEnd(agentId: string, entry: Tracked): void {
  const messages = conversationOf(agentId).messages;
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i]!;
    if (message.role !== "user") {
      continue;
    }
    if (message.checkpointId) {
      recordTurnEnd(entry.sessionId, message.checkpointId).catch(
        () => undefined,
      );
    }

    return;
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
      if (trackedEntry(agentId) === entry) {
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
    const entry = trackedEntry(agentId);
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
  const command = runnerCommandFor(agentId, payload.message);
  update(agentId, entry, (c) =>
    withInjectedPrompt(c, {
      id: crypto.randomUUID(),
      role: "system",
      ...(command ? { command } : {}),
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

const STDERR_TAIL = 20;

function stderr(agentId: string, entry: Tracked, line: string): void {
  if (!line) {
    return;
  }
  const diagnostic = parseCliDiagnostic(line);
  if (!diagnostic) {
    // Stderr is the CLI's log channel (MCP SDK notices etc.); it only explains anything once the process dies.
    const tail = (entry.stderrTail ??= []);
    tail.push(line);
    if (tail.length > STDERR_TAIL) {
      tail.shift();
    }

    return;
  }
  update(agentId, entry, (c) =>
    withSystemMessage(c, {
      id: crypto.randomUUID(),
      role: "system",
      tone: "warning",
      textBlocks: [diagnostic.title, ...diagnostic.details],
      toolCalls: [],
      timestamp: Date.now(),
    }),
  );
}

function flushStderr(agentId: string, entry: Tracked, exitCode: number): void {
  const tail = entry.stderrTail;
  entry.stderrTail = undefined;
  if (exitCode === 0 || !tail?.length) {
    return;
  }
  update(agentId, entry, (c) =>
    withSystemMessage(c, {
      id: crypto.randomUUID(),
      role: "system",
      tone: "error",
      textBlocks: [tail.join("\n")],
      toolCalls: [],
      timestamp: Date.now(),
    }),
  );
}

/**
 * Send a queued message ahead of the rest. A busy agent gets it mid-turn: the
 * CLI folds it in at the next tool boundary, or runs it straight after.
 */
export async function sendQueuedMessageNow(
  agentId: string,
  id: string,
): Promise<{ mid_turn: boolean }> {
  const agent = appState.agents.get(agentId);
  if (!agent) {
    throw `No agent found: ${agentId}`;
  }
  const entry = trackedEntry(agentId);
  // Read before the promote: its queue event drains an idle agent at once.
  const busy = agent.status !== "idle" || Boolean(entry?.inflight);
  if (!promoteQueuedMessage(agentId, id)) {
    throw `No queued message ${id} for ${agentId}`;
  }
  const live = agent.status !== "stopped" && agent.status !== "error";
  if (live && entry) {
    if (busy) {
      sendMidTurn(agentId, entry);
      telemetryCapture("queued_message_sent_now", { mid_turn: true });

      return { mid_turn: true };
    }
    trySendNextQueued(agentId, entry);
  }
  telemetryCapture("queued_message_sent_now", { mid_turn: false });

  return { mid_turn: false };
}

/**
 * Write the head of the queue into the running turn. No checkpoint: the turn
 * is mid-edit. The CLI reports one idle for the lot, and the queue drains then.
 */
function sendMidTurn(agentId: string, entry: Tracked): void {
  const next = listQueue(agentId)[0];
  if (!next) {
    return;
  }
  // Sent before the dequeue, so a failed write leaves it queued.
  sendAgentMessage(agentId, next.text, next.images);
  entry.inflight = true;
  dequeueMessage(agentId);
  userMessage(agentId, entry, next.display_text ?? next.text, {
    images: next.images,
    author: next.author,
    sent: next.text,
  });
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
  // Claimed before the dequeue: its queue event re-enters here synchronously.
  entry.inflight = true;
  const next = dequeueMessage(agentId);
  if (!next) {
    entry.inflight = false;

    return false;
  }
  (async () => {
    let checkpointId: string | undefined;
    try {
      checkpointId = (await createCheckpoint(entry.sessionId)).id;
    } catch {
      // A checkpoint is a nicety; the send goes ahead without one.
    }
    if (trackedEntry(agentId) !== entry) {
      return;
    }
    userMessage(agentId, entry, next.display_text ?? next.text, {
      images: next.images,
      author: next.author,
      checkpointId,
      sent: next.text,
    });
    try {
      sendAgentMessage(agentId, next.text, next.images);
    } catch (e) {
      entry.inflight = false;
      warn(`[conversations] queued send to ${agentId} failed: ${String(e)}`);
    }
  })().catch(() => undefined);

  return true;
}
