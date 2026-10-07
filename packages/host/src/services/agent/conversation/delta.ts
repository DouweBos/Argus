/**
 * What changed between two folds of a conversation. The reducer replaces a
 * message (and the conversation's fields) whenever they change, so this is a
 * reference walk — nothing is serialised to find a difference.
 */

import type { AgentConversation, ConversationMessage } from "./types";
import type {
  AgentConversationMeta,
  AgentTranscriptDelta,
  AgentTranscriptOp,
} from "@argus/remote-protocol";

type MetaPatch = NonNullable<AgentTranscriptDelta["meta"]>;

export function diffMessages(
  prev: ConversationMessage[],
  next: ConversationMessage[],
): AgentTranscriptOp[] {
  if (prev === next) {
    return [];
  }
  const ops: AgentTranscriptOp[] = [];
  for (let i = prev.length - 1; i >= next.length; i--) {
    ops.push({ op: "remove", index: i, id: prev[i]!.id });
  }
  const common = Math.min(prev.length, next.length);
  for (let i = 0; i < common; i++) {
    if (prev[i] !== next[i]) {
      ops.push({ op: "update", index: i, message: next[i]! });
    }
  }
  for (let i = prev.length; i < next.length; i++) {
    ops.push({ op: "append", index: i, message: next[i]! });
  }

  return ops;
}

/**
 * A Task/Agent call anywhere in the history that hasn't returned. Tolerates
 * the loose messages an old saved chat can hold.
 */
export function hasRunningSubagents(messages: ConversationMessage[]): boolean {
  for (let i = messages.length - 1; i >= 0; i--) {
    for (const tc of messages[i]!.toolCalls ?? []) {
      if (
        (tc.name === "Task" || tc.name === "Agent") &&
        tc.result === undefined &&
        !tc.pendingPermission
      ) {
        return true;
      }
    }
  }

  return false;
}

export function firstUserText(
  messages: ConversationMessage[],
): string | undefined {
  return messages.find((m) => m.role === "user")?.textBlocks?.[0];
}

/** The conversation's fields, plus what viewers would otherwise rescan. */
export function conversationMeta(
  conv: AgentConversation,
): AgentConversationMeta {
  const { messages, ...rest } = conv;

  return {
    ...rest,
    firstUserText: firstUserText(messages),
    runningSubagents: hasRunningSubagents(messages),
  };
}

/** Fields of `next` that differ from `prev`; a field that went away is null. */
export function diffMeta(
  prev: AgentConversationMeta,
  next: AgentConversationMeta,
): MetaPatch | undefined {
  const patch: Record<string, unknown> = {};
  let changed = false;
  const keys = new Set([...Object.keys(prev), ...Object.keys(next)]);
  for (const key of keys) {
    const a = prev[key as keyof AgentConversationMeta];
    const b = next[key as keyof AgentConversationMeta];
    if (a !== b) {
      patch[key] = b === undefined ? null : b;
      changed = true;
    }
  }

  if (!changed) {
    return undefined;
  }
  // A task list is its map plus its order; one is no use without the other.
  if ("tasks" in patch || "taskOrder" in patch) {
    patch.tasks = next.tasks ?? null;
    patch.taskOrder = next.taskOrder ?? null;
  }

  return patch as MetaPatch;
}

/** Apply a patch: null removes the field. */
export function applyMetaPatch<T extends object>(meta: T, patch: MetaPatch): T {
  const next: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(meta)) {
    if (!(key in patch)) {
      next[key] = value;
    }
  }
  for (const [key, value] of Object.entries(patch)) {
    if (value !== null) {
      next[key] = value;
    }
  }

  return next as T;
}
