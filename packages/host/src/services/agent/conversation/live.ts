/**
 * The conversations the host is folding, and the deltas viewers follow them
 * by. Each one carries an `epoch` (minted whenever it is (re)seeded) and a
 * `revision` bumped per emitted delta, so a viewer can tell a gap from a
 * duplicate and refetch only when it must.
 */

import type { AgentConversation } from "./types";
import type {
  AgentConversationMeta,
  AgentTranscriptDelta,
  AgentTranscriptPage,
} from "@argus/remote-protocol";
import { emitHostEvent } from "@argus/host/bus";
import { getParsedAgentSnapshot } from "../snapshots";
import { conversationMeta, diffMessages, diffMeta } from "./delta";

/** Long enough to fold a burst of events into one delta, short enough to read as live. */
const EMIT_DELAY_MS = 16;
const DEFAULT_PAGE = 100;
const MAX_PAGE = 500;

interface Live {
  conversation: AgentConversation;
  emitted: AgentConversation;
  emittedMeta: AgentConversationMeta;
  emitTimer?: NodeJS.Timeout;
  epoch: string;
  revision: number;
}

const live = new Map<string, Live>();

/** Start (or restart, under a new epoch) following an agent's conversation. */
export function seedLive(
  agentId: string,
  conversation: AgentConversation,
): void {
  const existing = live.get(agentId);
  clearTimeout(existing?.emitTimer);
  const entry: Live = {
    conversation,
    emitted: conversation,
    emittedMeta: conversationMeta(conversation),
    epoch: crypto.randomUUID(),
    revision: 0,
  };
  live.set(agentId, entry);
  if (existing) {
    // Viewers holding the old epoch need a delta to notice it and refetch.
    entry.revision = 1;
    emitHostEvent(`agent:transcript:${agentId}`, {
      agentId,
      epoch: entry.epoch,
      revision: entry.revision,
      total: conversation.messages.length,
      ops: [],
    } satisfies AgentTranscriptDelta);
  }
}

export function isLive(agentId: string): boolean {
  return live.has(agentId);
}

/** The conversation's fields as of the last delta sent. */
export function liveMeta(agentId: string): AgentConversationMeta | null {
  return live.get(agentId)?.emittedMeta ?? null;
}

export function liveConversation(agentId: string): AgentConversation | null {
  return live.get(agentId)?.conversation ?? null;
}

/** Replace the conversation; viewers hear about it on the next emit. */
export function setLive(
  agentId: string,
  conversation: AgentConversation,
): void {
  const entry = live.get(agentId);
  if (!entry || entry.conversation === conversation) {
    return;
  }
  entry.conversation = conversation;
  if (!entry.emitTimer) {
    entry.emitTimer = setTimeout(() => {
      entry.emitTimer = undefined;
      emit(agentId, entry);
    }, EMIT_DELAY_MS);
  }
}

/** Send whatever is pending now. */
export function flushLive(agentId: string): void {
  const entry = live.get(agentId);
  if (!entry) {
    return;
  }
  clearTimeout(entry.emitTimer);
  entry.emitTimer = undefined;
  emit(agentId, entry);
}

export function dropLive(agentId: string): void {
  flushLive(agentId);
  live.delete(agentId);
}

/** Test-only. */
export function resetLive(): void {
  for (const entry of live.values()) {
    clearTimeout(entry.emitTimer);
  }
  live.clear();
}

function emit(agentId: string, entry: Live): void {
  const next = entry.conversation;
  if (next === entry.emitted) {
    return;
  }
  const ops = diffMessages(entry.emitted.messages, next.messages);
  const nextMeta =
    next.messages === entry.emitted.messages && sameFields(entry.emitted, next)
      ? entry.emittedMeta
      : conversationMeta(next);
  const meta = diffMeta(entry.emittedMeta, nextMeta);
  entry.emitted = next;
  entry.emittedMeta = nextMeta;
  if (ops.length === 0 && !meta) {
    return;
  }
  entry.revision += 1;
  const delta: AgentTranscriptDelta = {
    agentId,
    epoch: entry.epoch,
    revision: entry.revision,
    total: next.messages.length,
    ops,
    ...(meta ? { meta } : {}),
  };
  emitHostEvent(`agent:transcript:${agentId}`, delta);
}

function sameFields(a: AgentConversation, b: AgentConversation): boolean {
  for (const key of Object.keys(b) as (keyof AgentConversation)[]) {
    if (key !== "messages" && a[key] !== b[key]) {
      return false;
    }
  }

  return Object.keys(a).length === Object.keys(b).length;
}

/**
 * A page of an agent's history: `before` → the page ending there, otherwise
 * the newest. Null when the host isn't following the agent.
 */
export function livePage(
  agentId: string,
  cursor: { before?: number; limit?: number } = {},
): AgentTranscriptPage | null {
  const entry = live.get(agentId);
  if (!entry) {
    return null;
  }
  // A page has to line up with the deltas already sent, not ones still pending.
  flushLive(agentId);
  const { messages } = entry.emitted;
  const size = Math.min(Math.max(1, cursor.limit ?? DEFAULT_PAGE), MAX_PAGE);
  const end = Math.min(cursor.before ?? messages.length, messages.length);
  const start = Math.max(0, end - size);

  return {
    epoch: entry.epoch,
    revision: entry.revision,
    total: messages.length,
    start,
    messages: messages.slice(start, end),
    meta: entry.emittedMeta,
  };
}

/** Where the live page came from, for gateway pages built from it. */
export function liveCursor(
  agentId: string,
): { epoch: string; revision: number } | null {
  const entry = live.get(agentId);
  if (!entry) {
    return null;
  }
  flushLive(agentId);

  return { epoch: entry.epoch, revision: entry.revision };
}

/**
 * The conversation to read for an agent: the host's own fold, or — while a UI
 * still owns conversations — the snapshot it last published.
 */
export function readConversation(agentId: string): AgentConversation | null {
  const entry = live.get(agentId);
  if (entry) {
    return entry.conversation;
  }

  return getParsedAgentSnapshot<AgentConversation>(agentId);
}
