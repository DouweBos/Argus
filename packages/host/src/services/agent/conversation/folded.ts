/**
 * The conversations the host is folding, and what changes them: the state the
 * event routing (`./hostDriver`) and viewer requests (`./actions`) share.
 */

import type { ImageAttachment, AgentConversation } from "./types";
import { IMAGES_ONLY_PROMPT } from "@argus/remote-protocol";
import { warn } from "@argus/host/logger";
import { appState } from "../../../state";
import { generateChatTitle } from "../../llm/titleGenerator";
import { describeAgentCommand } from "../argusCommands/agentCommand";
import { saveConversation } from "../chatHistory";
import {
  dropLive,
  liveConversation,
  seedLive,
  setLive,
  takeStagedConversation,
} from "./live";
import { deriveTitle, emptyConversation, withUserMessage } from "./reducer";

/**
 * Mid-turn history writes, at most this often: a long chat is megabytes. Turn
 * ends, exits and stops write at once.
 */
const SAVE_INTERVAL_MS = 10_000;
export interface Tracked {
  sessionId: string;
  parentAgentId: string | null;
  runnerId?: string;
  /** A message went in and no idle came back yet. */
  inflight: boolean;
  finished?: { durationMs: number; failed: boolean };
  saveTimer?: NodeJS.Timeout;
  titleRequested?: boolean;
  /** Recent plain stderr lines, shown only if the process dies. */
  stderrTail?: string[];
}

const tracked = new Map<string, Tracked>();

export function trackedEntry(agentId: string): Tracked | undefined {
  return tracked.get(agentId);
}

export function trackedAgentIds(): string[] {
  return [...tracked.keys()];
}

export function untrack(agentId: string): void {
  const entry = tracked.get(agentId);
  clearTimeout(entry?.saveTimer);
  tracked.delete(agentId);
  dropLive(agentId);
}

export function track(
  agentId: string,
  sessionId: string,
  parentAgentId: string | null,
  runnerId?: string,
): Tracked {
  const existing = tracked.get(agentId);
  if (existing) {
    return existing;
  }
  seedLive(agentId, takeStagedConversation(agentId) ?? emptyConversation());
  const entry: Tracked = {
    sessionId,
    parentAgentId,
    runnerId,
    inflight: appState.agents.get(agentId)?.status === "running",
  };
  tracked.set(agentId, entry);

  return entry;
}

// --- What viewer requests (`./actions`) change ----------------------

/** Whether the host is folding this agent's conversation. */
export function isFolding(agentId: string): boolean {
  return tracked.has(agentId);
}

/** Apply `fn` to a folded conversation. False when the host isn't folding it. */
export function changeConversation(
  agentId: string,
  fn: (c: AgentConversation) => AgentConversation | null,
): boolean {
  const entry = tracked.get(agentId);
  if (!entry) {
    return false;
  }
  update(agentId, entry, fn);

  return true;
}

/** Record a message the user sent, and title the chat from it if untitled. */
export function recordUserMessage(
  agentId: string,
  text: string,
  options: {
    author?: string;
    checkpointId?: string;
    images?: ImageAttachment[];
    /** What goes to the agent, when the bubble shows something else. */
    sent?: string;
  },
): void {
  const entry = tracked.get(agentId);
  if (entry) {
    userMessage(agentId, entry, text, options);
  }
}

/** A message is on its way to the CLI (or isn't any more). */
export function setInflight(agentId: string, inflight: boolean): void {
  const entry = tracked.get(agentId);
  if (entry) {
    entry.inflight = inflight;
  }
}

export function isInflight(agentId: string): boolean {
  return tracked.get(agentId)?.inflight ?? false;
}

/** Start the conversation over from `conversation` — a fork's backfill. */
export function reseedConversation(
  agentId: string,
  conversation: AgentConversation,
): void {
  const entry = tracked.get(agentId);
  if (!entry) {
    return;
  }
  seedLive(agentId, conversation);
  entry.titleRequested = Boolean(conversation.title);
  save(agentId);
}

export function userMessage(
  agentId: string,
  entry: Tracked,
  text: string,
  options: {
    author?: string;
    checkpointId?: string;
    images?: ImageAttachment[];
    sent?: string;
  } = {},
): void {
  const { sent, ...rest } = options;
  const command = describeAgentCommand(agentId, sent ?? text);
  update(agentId, entry, (c) => withUserMessage(c, text, { ...rest, command }));
  maybeGenerateTitle(agentId, entry, text);
}

export function maybeGenerateTitle(
  agentId: string,
  entry: Tracked,
  firstMessage: string,
): void {
  if (entry.titleRequested || conversationOf(agentId).title) {
    entry.titleRequested = true;

    return;
  }
  const text = firstMessage.trim();
  // Left untitled so the first message with words names it.
  if (!text || text === IMAGES_ONLY_PROMPT) {
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

export function conversationOf(agentId: string): AgentConversation {
  return liveConversation(agentId) ?? emptyConversation();
}

export function update(
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

/** Upserts by the CLI session id, so repeat saves overwrite one record. */
export function save(agentId: string): void {
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
  const agent = appState.agents.get(agentId);
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
      permissionMode: agent?.permissionMode ?? undefined,
      effort: agent?.effort ?? undefined,
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
