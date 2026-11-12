/**
 * What a viewer asks of a conversation the host folds: send a message, rewind
 * to one, fork from one, rename, dismiss a list, clear. A viewer only holds a
 * page of the history, so anything that needs the whole of it happens here.
 */

import type { AgentSession } from "../models";
import type {
  AgentConversation,
  ConversationMessage,
  ImageAttachment,
} from "./types";
import type { LlmRunner } from "../../llm/runners/types";
import type { ForkReplayOp } from "@argus/remote-protocol";
import { emitHostEvent } from "@argus/host/bus";
import { appState } from "../../../state";
import { restoreAgentAtTurn, sendAgentMessage } from "../agentService";
import { createCheckpoint, restoreCheckpoint } from "../checkpoints";
import { clearQueue, enqueueMessage, listQueue } from "../messageQueue";
import { runnerCommandFor } from "../runnerCommand";
import {
  changeConversation,
  isFolding,
  isInflight,
  recordUserMessage,
  reseedConversation,
  setInflight,
} from "./folded";
import { liveConversation } from "./live";
import { fromSavedMessages } from "./reducer";

/**
 * Whether a turn is still in flight. Status alone understates it: the CLI
 * flips `session_state_changed` to idle between tool calls, so a message sent
 * on that reading lands mid-turn instead of waiting its place in the queue.
 */
export function isAgentWorking(agent: AgentSession): boolean {
  return (
    agent.status === "running" ||
    agent.status === "requires_action" ||
    agent.inflightPrompts > 0
  );
}

function requireAgent(agentId: string): AgentSession {
  const agent = appState.agents.get(agentId);
  if (!agent) {
    throw `No agent found: ${agentId}`;
  }

  return agent;
}

function requireConversation(agentId: string): AgentConversation {
  const conv = liveConversation(agentId);
  if (!conv) {
    throw `No conversation for agent ${agentId}`;
  }

  return conv;
}

export interface SubmittedMessage {
  /** Who sent it, when not the engineer at this host. */
  author?: string;
  /** What the transcript shows, when it differs from what the agent gets. */
  displayText?: string;
  images?: ImageAttachment[];
  text: string;
}

/**
 * Send now, or queue behind the turn in flight — decided here, not by the
 * client, whose view of the agent's status can lag a turn that just started.
 * A sent message gets a worktree checkpoint and its bubble in the transcript.
 */
export async function submitAgentMessage(
  agentId: string,
  message: SubmittedMessage,
): Promise<{ queued: boolean }> {
  const agent = requireAgent(agentId);
  if (
    isAgentWorking(agent) ||
    isInflight(agentId) ||
    listQueue(agentId).length > 0
  ) {
    enqueueMessage(agentId, message);

    return { queued: true };
  }
  if (!isFolding(agentId)) {
    // A UI still folds this conversation; it records the bubble from this.
    sendAgentMessage(agentId, message.text, message.images);
    emitHostEvent(`agent:remote-message:${agentId}`, {
      message: message.displayText ?? message.text,
      images: message.images,
      author: message.author ?? null,
      sent: message.text,
    });

    return { queued: false };
  }
  // Claimed before the await, so a second submit queues instead.
  setInflight(agentId, true);
  let checkpointId: string | undefined;
  try {
    checkpointId = (await createCheckpoint(agent.sessionId)).id;
  } catch {
    // A checkpoint is a nicety; the send goes ahead without one.
  }
  recordUserMessage(agentId, message.displayText ?? message.text, {
    author: message.author,
    checkpointId,
    images: message.images,
    sent: message.text,
  });
  try {
    sendAgentMessage(agentId, message.text, message.images);
  } catch (e) {
    setInflight(agentId, false);
    throw e;
  }

  return { queued: false };
}

function userTurnsBefore(messages: ConversationMessage[], end: number): number {
  let n = 0;
  for (let i = 0; i < end; i++) {
    if (messages[i]!.role === "user") {
      n += 1;
    }
  }

  return n;
}

function indexOfMessage(conv: AgentConversation, messageId: string): number {
  const idx = conv.messages.findIndex((m) => m.id === messageId);
  if (idx < 0) {
    throw "Message not found";
  }

  return idx;
}

/**
 * Rewind the agent to just before one of the user's messages: the transcript
 * is cut there, the CLI respawns on a transcript forked at that turn, and the
 * queue (written against turns that no longer exist) is dropped. `resend`
 * sends an edited message in its place; `restoreFiles` also puts the worktree
 * back to the message's checkpoint.
 */
export async function rewindAgent(
  agentId: string,
  messageId: string,
  options: {
    resend?: { images?: ImageAttachment[]; text: string };
    restoreFiles?: boolean;
  } = {},
): Promise<{ claude_session_id: string | null; restoredPrompt: string }> {
  const agent = requireAgent(agentId);
  // Before the transcript is cut: a refusal afterwards would lose turns.
  requireTranscriptFork(agent.runner);
  const conv = requireConversation(agentId);
  const claudeSessionId = conv.sessionId;
  if (!claudeSessionId) {
    throw "Session is missing a Claude session id to restore from";
  }
  const idx = indexOfMessage(conv, messageId);
  const target = conv.messages[idx]!;
  if (target.role !== "user") {
    throw "Only user messages can be restored from";
  }
  if (options.restoreFiles && !target.checkpointId) {
    throw "This message has no checkpoint to restore from";
  }
  const { resend } = options;
  if (resend) {
    setInflight(agentId, true);
  }
  changeConversation(agentId, (c) => ({
    ...c,
    sessionId: undefined,
    resuming: false,
    lastEventType: resend ? "user_sent" : undefined,
    messages: [
      ...c.messages.slice(0, idx),
      ...(resend
        ? [
            {
              id: crypto.randomUUID(),
              role: "user" as const,
              textBlocks: [resend.text],
              toolCalls: [],
              timestamp: Date.now(),
              images: resend.images?.length ? resend.images : undefined,
              command: runnerCommandFor(agentId, resend.text),
            },
          ]
        : []),
    ],
  }));
  clearQueue(agentId);

  const result = await restoreAgentAtTurn({
    agentId,
    sourceClaudeSessionId: claudeSessionId,
    keepTurnNumber: userTurnsBefore(conv.messages, idx),
    cutoffTimestampMs: target.timestamp,
  });
  if (options.restoreFiles && target.checkpointId) {
    await restoreCheckpoint(agent.sessionId, target.checkpointId);
  }
  changeConversation(agentId, (c) => ({
    ...c,
    sessionId: result.claude_session_id ?? undefined,
  }));
  if (resend) {
    sendAgentMessage(agentId, resend.text, resend.images);
  }

  return {
    claude_session_id: result.claude_session_id,
    restoredPrompt: target.textBlocks.join("\n\n"),
  };
}

/** Rewind and fork both rebuild the CLI's transcript; Codex can't. */
export function requireTranscriptFork(runner: LlmRunner): void {
  if (!runner.capabilities().supportsTranscriptFork) {
    throw `${runner.displayName} can't rewind or fork a conversation`;
  }
}

export interface AgentForkPoint {
  claudeSessionId: string | null;
  model?: string;
  /** Edits and writes up to the fork, to replay onto the fork's worktree. */
  replayOps: ForkReplayOp[];
  timestampMs: number;
  title?: string;
  /** User turns up to and including the fork message. */
  turnNumber: number;
}

/** What forking at `messageId` needs from the whole history. */
export function agentForkPoint(
  agentId: string,
  messageId: string,
): AgentForkPoint {
  const conv = requireConversation(agentId);
  const idx = indexOfMessage(conv, messageId);

  return {
    claudeSessionId: conv.sessionId ?? null,
    model: conv.model,
    replayOps: collectReplayOps(conv.messages, idx),
    timestampMs: conv.messages[idx]!.timestamp,
    title: conv.title,
    turnNumber: userTurnsBefore(conv.messages, idx + 1),
  };
}

/**
 * Give a freshly started fork the history up to and including the fork
 * message. `resuming` skips the turn the CLI replays on `--resume`.
 */
export function seedForkedConversation(
  agentId: string,
  from: { agentId: string; throughMessageId: string },
  resumeSessionId: string | undefined,
): void {
  const source = requireConversation(from.agentId);
  const idx = indexOfMessage(source, from.throughMessageId);
  reseedConversation(
    agentId,
    fromSavedMessages(source.messages.slice(0, idx + 1), {
      model: source.model,
      sessionId: resumeSessionId,
      resuming: resumeSessionId != null,
      title: source.title,
    }),
  );
}

export function setConversationTitle(agentId: string, title: string): void {
  requireAgent(agentId);
  changeConversation(agentId, (c) => ({ ...c, title }));
}

/** Hide the todo or task list until the agent writes a new one. */
export function dismissConversationList(
  agentId: string,
  list: "tasks" | "todos",
): void {
  changeConversation(agentId, (c) =>
    list === "todos" ? { ...c, todos: null } : { ...c, tasks: null },
  );
}

/** Empty the transcript; the CLI keeps its context. */
export function clearConversation(agentId: string): void {
  changeConversation(agentId, (c) => ({
    ...c,
    messages: [],
    todos: null,
    tasks: null,
    taskOrder: undefined,
  }));
}

/**
 * Edit/Write/MultiEdit calls up to the fork point. The fork's worktree is
 * reset to the newest commit before the fork message, then these replay the
 * uncommitted changes made between that commit and the message.
 */
function collectReplayOps(
  messages: ConversationMessage[],
  upToIdx: number,
): ForkReplayOp[] {
  const ops: ForkReplayOp[] = [];
  for (let i = 0; i <= upToIdx; i++) {
    const msg = messages[i]!;
    for (const tc of msg.toolCalls) {
      if (tc.isError) {
        continue;
      }
      const op = replayOp(tc.name, tc.input, msg.timestamp);
      if (op) {
        ops.push(op);
      }
    }
  }

  return ops;
}

function replayOp(
  name: string,
  input: Record<string, unknown>,
  timestampMs: number,
): ForkReplayOp | null {
  const filePath = input.file_path;
  if (typeof filePath !== "string") {
    return null;
  }
  if (name === "Write" && typeof input.content === "string") {
    return { type: "write", filePath, content: input.content, timestampMs };
  }
  if (
    name === "Edit" &&
    typeof input.old_string === "string" &&
    typeof input.new_string === "string"
  ) {
    return {
      type: "edit",
      filePath,
      oldString: input.old_string,
      newString: input.new_string,
      replaceAll: input.replace_all === true,
      timestampMs,
    };
  }
  if (name === "MultiEdit" && Array.isArray(input.edits)) {
    const edits = input.edits.flatMap((e) => {
      const rec = e as Record<string, unknown>;

      return typeof rec.old_string === "string" &&
        typeof rec.new_string === "string"
        ? [
            {
              oldString: rec.old_string,
              newString: rec.new_string,
              replaceAll: rec.replace_all === true,
            },
          ]
        : [];
    });

    return edits.length > 0
      ? { type: "multiEdit", filePath, edits, timestampMs }
      : null;
  }

  return null;
}
