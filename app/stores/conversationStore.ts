import type {
  AgentConversation,
  ConversationMessage,
} from "@argus/host/services/agent/conversation/types";
import type {
  AgentTranscriptDelta,
  AgentTranscriptPage,
} from "@argus/remote-protocol";
import { create } from "zustand";
import { hasRunningSubagents as hostHasRunningSubagents } from "@argus/host/services/agent/conversation/delta";
import {
  fromSavedMessages,
  withPermissionPending,
} from "@argus/host/services/agent/conversation/reducer";
import { rememberContextWindow } from "../lib/contextWindow";
import { persistLastKnownCapabilities } from "../lib/lastKnownCapabilities";
import {
  applyDelta,
  fromPage,
  prependPage,
  type TranscriptWindow,
  trimWindow,
  type Viewed,
  type ViewedConversation,
} from "../lib/transcriptWindow";

export type {
  AgentConversation,
  ConversationMessage,
  SystemMessageSource,
  Task,
  TodoItem,
  ToolCallChild,
  ToolCallInfo,
  ToolResultBlock,
} from "@argus/host/services/agent/conversation/types";

export type { TranscriptWindow, ViewedConversation };

export interface PendingImage {
  attachment: { data: string; media_type: string };
  name: string;
  previewUrl: string;
}

interface ConversationStoreData {
  /**
   * What this window shows of each agent's conversation. The host owns the
   * conversation; this holds the pages loaded so far, kept current by deltas.
   */
  conversations: Record<string, ViewedConversation>;
  /** Draft message text per agent, preserved across tab switches. */
  drafts: Record<string, string>;
  /**
   * Absolute paths of extra project directories linked to a chat. The agent
   * is allowed to read from and write into these directories in addition to
   * its own worktree. Preserved across tab switches for the agent's lifetime.
   */
  linkedProjects: Record<string, string[]>;
  /** Pending image attachments per agent, preserved across tab switches. */
  pendingImages: Record<string, PendingImage[]>;
  /**
   * Assistant message IDs streamed during the current turn. They become unread
   * only once the turn finishes (the `result` event), so an actively-streaming
   * agent doesn't keep re-asserting unread state as each chunk arrives.
   */
  pendingUnread: Record<string, ReadonlySet<string>>;
  /**
   * Per-tool-call draft state for interactive permission prompts
   * (AskUserQuestion, ExitPlanMode). Keyed by toolUseId so input survives
   * agent/view switches while the prompt is still pending. The shape is
   * form-specific — each form picks the type when reading.
   */
  toolDrafts: Record<string, unknown>;
  /**
   * Set of assistant message IDs currently marked unread, per agent. New
   * assistant messages are added on turn completion and removed when the user
   * scrolls them into view. Users can also manually toggle a message back to
   * unread.
   */
  unreadMessages: Record<string, ReadonlySet<string>>;
  /** Where each followed conversation's loaded messages sit in the host's. */
  windows: Record<string, TranscriptWindow>;
}

const conversationStore = create<ConversationStoreData>(() => ({
  conversations: {},
  windows: {},
  drafts: {},
  linkedProjects: {},
  pendingImages: {},
  toolDrafts: {},
  pendingUnread: {},
  unreadMessages: {},
}));

const EMPTY_UNREAD_SET: ReadonlySet<string> = new Set<string>();

function addUnreadId(
  unread: Record<string, ReadonlySet<string>>,
  agentId: string,
  messageId: string,
): Record<string, ReadonlySet<string>> {
  const existing = unread[agentId];
  const next = new Set(existing ?? EMPTY_UNREAD_SET);
  if (next.has(messageId)) {
    return unread;
  }
  next.add(messageId);

  return { ...unread, [agentId]: next };
}

function removeUnreadId(
  unread: Record<string, ReadonlySet<string>>,
  agentId: string,
  messageId: string,
): Record<string, ReadonlySet<string>> {
  const existing = unread[agentId];
  if (!existing || !existing.has(messageId)) {
    return unread;
  }
  const next = new Set(existing);
  next.delete(messageId);
  if (next.size === 0) {
    const { [agentId]: _removed, ...rest } = unread;

    return rest;
  }

  return { ...unread, [agentId]: next };
}

const useConversationStore = conversationStore;

export function clearConversation(agentId: string) {
  conversationStore.setState((state) => {
    const { [agentId]: _removed, ...next } = state.conversations;
    const { [agentId]: _removedUnread, ...nextUnread } = state.unreadMessages;
    const { [agentId]: _removedPending, ...nextPending } = state.pendingUnread;
    const { [agentId]: _removedWindow, ...nextWindows } = state.windows;

    return {
      conversations: next,
      unreadMessages: nextUnread,
      pendingUnread: nextPending,
      windows: nextWindows,
    };
  });
}

export function markMessageRead(agentId: string, messageId: string) {
  conversationStore.setState((state) => {
    const next = removeUnreadId(state.unreadMessages, agentId, messageId);
    const nextPending = removeUnreadId(state.pendingUnread, agentId, messageId);
    if (next === state.unreadMessages && nextPending === state.pendingUnread) {
      return state;
    }

    return { unreadMessages: next, pendingUnread: nextPending };
  });
}

/**
 * Promote this turn's pending-unread messages into the visible unread set.
 * Called when the agent transitions to `idle`, so the chat tab only flags
 * unread once the agent has actually stopped working — not on every `result`
 * event (which can be followed by another queued turn).
 */
export function flushPendingUnread(agentId: string) {
  conversationStore.setState((state) => {
    const pending = state.pendingUnread[agentId];
    if (!pending || pending.size === 0) {
      return state;
    }
    const merged = new Set(state.unreadMessages[agentId] ?? EMPTY_UNREAD_SET);
    for (const id of pending) {
      merged.add(id);
    }
    const { [agentId]: _drop, ...rest } = state.pendingUnread;

    return {
      unreadMessages: { ...state.unreadMessages, [agentId]: merged },
      pendingUnread: rest,
    };
  });
}

export function clearAgentUnread(agentId: string) {
  conversationStore.setState((state) => {
    const hasUnread = agentId in state.unreadMessages;
    const hasPending = agentId in state.pendingUnread;
    if (!hasUnread && !hasPending) {
      return state;
    }
    const next: Partial<ConversationStoreData> = {};
    if (hasUnread) {
      const { [agentId]: _removed, ...rest } = state.unreadMessages;
      next.unreadMessages = rest;
    }
    if (hasPending) {
      const { [agentId]: _removed, ...rest } = state.pendingUnread;
      next.pendingUnread = rest;
    }

    return next;
  });
}

function viewedOf(
  state: ConversationStoreData,
  agentId: string,
): Viewed | null {
  const conversation = state.conversations[agentId];
  const window = state.windows[agentId];

  return conversation && window ? { conversation, window } : null;
}

function withViewed(
  state: ConversationStoreData,
  agentId: string,
  viewed: Viewed,
): Pick<ConversationStoreData, "conversations" | "windows"> {
  return {
    conversations: { ...state.conversations, [agentId]: viewed.conversation },
    windows: { ...state.windows, [agentId]: viewed.window },
  };
}

/** Show the newest page of an agent's conversation, replacing what was loaded. */
export function applyTranscriptPage(
  agentId: string,
  page: AgentTranscriptPage,
) {
  conversationStore.setState((state) =>
    withViewed(state, agentId, fromPage(page)),
  );
  rememberMeta(page.meta);
}

/** Put an older page in front. False when it no longer lines up. */
export function prependTranscriptPage(
  agentId: string,
  page: AgentTranscriptPage,
): boolean {
  let ok = false;
  conversationStore.setState((state) => {
    const viewed = viewedOf(state, agentId);
    const next = viewed ? prependPage(viewed, page) : null;
    if (!next) {
      return state;
    }
    ok = true;

    return withViewed(state, agentId, next);
  });

  return ok;
}

/** Keep only the newest `keep` loaded messages of a followed conversation. */
export function trimTranscript(agentId: string, keep: number) {
  conversationStore.setState((state) => {
    const viewed = viewedOf(state, agentId);
    if (!viewed) {
      return state;
    }
    const next = trimWindow(viewed, keep);

    return next === viewed ? state : withViewed(state, agentId, next);
  });
}

/**
 * Apply a host delta. "gap" means it doesn't follow what is loaded — the
 * caller refetches; "stale" means it was already in the page.
 */
export function applyTranscriptDelta(
  agentId: string,
  delta: AgentTranscriptDelta,
): "applied" | "gap" | "stale" {
  let kind = "gap" as "applied" | "gap" | "stale";
  conversationStore.setState((state) => {
    const viewed = viewedOf(state, agentId);
    if (!viewed) {
      return state;
    }
    const outcome = applyDelta(viewed, delta);
    kind = outcome.kind;
    if (outcome.kind !== "applied") {
      return state;
    }
    // A new assistant message is pending-unread for this turn, graduating to
    // unread only once the agent goes idle — so a streaming agent doesn't keep
    // re-asserting unread state. Tool-call-only messages have nothing to read.
    let pendingUnread = state.pendingUnread;
    let unreadMessages = state.unreadMessages;
    for (const op of delta.ops) {
      if (op.op === "remove") {
        pendingUnread = removeUnreadId(pendingUnread, agentId, op.id);
        unreadMessages = removeUnreadId(unreadMessages, agentId, op.id);
      }
    }
    for (const added of outcome.appended) {
      const readable =
        added.role === "assistant" &&
        (added.textBlocks.some((t) => t.trim().length > 0) ||
          added.toolCalls.length === 0);
      if (readable) {
        pendingUnread = addUnreadId(pendingUnread, agentId, added.id);
      }
    }

    return {
      ...withViewed(state, agentId, outcome.viewed),
      pendingUnread,
      unreadMessages,
    };
  });
  if (kind === "applied" && delta.meta) {
    rememberMeta(getConversationState().conversations[agentId] ?? {});
  }

  return kind;
}

/** Cache what the start-agent dialogs show before any agent is running. */
function rememberMeta(meta: Partial<ViewedConversation>) {
  if (meta.model && meta.contextWindow) {
    rememberContextWindow(meta.model, meta.contextWindow);
  }
  if (meta.capabilities) {
    persistLastKnownCapabilities({
      models: meta.capabilities.models?.map((m) => ({
        value: m.value,
        displayName: m.displayName,
        description: m.description,
      })),
      slashCommands: meta.capabilities.commands,
    });
  }
}

/**
 * Show a conversation nothing follows: an older host's snapshot, or a saved
 * chat being previewed.
 */
export function setStaticConversation(
  agentId: string,
  conversation: AgentConversation,
) {
  conversationStore.setState((state) => {
    const { [agentId]: _removed, ...windows } = state.windows;

    return {
      conversations: { ...state.conversations, [agentId]: conversation },
      windows,
    };
  });
}

/** A saved chat, shown read-only. */
export function loadSavedMessages(
  agentId: string,
  messages: ConversationMessage[],
  model?: string,
  sessionId?: string,
  resuming?: boolean,
  title?: string,
) {
  setStaticConversation(
    agentId,
    fromSavedMessages(messages, { model, sessionId, resuming, title }),
  );
}

/**
 * Drop a prompt the user just answered without waiting for the host's delta.
 * Walks the full tool-call tree: a subagent's call nests under its parent.
 */
export function clearPermission(agentId: string, toolUseId: string) {
  conversationStore.setState((state) => {
    const existing = state.conversations[agentId];
    const next = existing
      ? withPermissionPending(existing, toolUseId, false)
      : null;
    if (!next) {
      return state;
    }

    return { conversations: { ...state.conversations, [agentId]: next } };
  });
}

export function setDraft(agentId: string, text: string) {
  conversationStore.setState((state) => {
    if (text) {
      return { drafts: { ...state.drafts, [agentId]: text } };
    }
    const { [agentId]: _removed, ...drafts } = state.drafts;

    return { drafts };
  });
}

export function getDraft(agentId: string): string {
  return conversationStore.getState().drafts[agentId] ?? "";
}

const EMPTY_PENDING_IMAGES: PendingImage[] = [];

export function getPendingImages(agentId: string): PendingImage[] {
  return (
    conversationStore.getState().pendingImages[agentId] ?? EMPTY_PENDING_IMAGES
  );
}

export function setPendingImages(agentId: string, images: PendingImage[]) {
  conversationStore.setState((state) => {
    if (images.length === 0) {
      const { [agentId]: _removed, ...next } = state.pendingImages;

      return { pendingImages: next };
    }

    return {
      pendingImages: { ...state.pendingImages, [agentId]: images },
    };
  });
}

const EMPTY_LINKED_PROJECTS: string[] = [];

export function getLinkedProjects(agentId: string): string[] {
  return (
    conversationStore.getState().linkedProjects[agentId] ??
    EMPTY_LINKED_PROJECTS
  );
}

export function setLinkedProjects(agentId: string, paths: string[]) {
  conversationStore.setState((state) => {
    if (paths.length === 0) {
      const { [agentId]: _removed, ...next } = state.linkedProjects;

      return { linkedProjects: next };
    }

    return {
      linkedProjects: { ...state.linkedProjects, [agentId]: paths },
    };
  });
}

export const useLinkedProjects = (agentId: string | null | undefined) =>
  useConversationStore((state) =>
    agentId
      ? (state.linkedProjects[agentId] ?? EMPTY_LINKED_PROJECTS)
      : EMPTY_LINKED_PROJECTS,
  );

export const usePendingImages = (agentId: string | null | undefined) =>
  useConversationStore((state) =>
    agentId
      ? (state.pendingImages[agentId] ?? EMPTY_PENDING_IMAGES)
      : EMPTY_PENDING_IMAGES,
  );

export function clearDraft(agentId: string) {
  conversationStore.setState((state) => {
    if (!(agentId in state.drafts)) {
      return state;
    }
    const { [agentId]: _removed, ...drafts } = state.drafts;

    return { drafts };
  });
}

export function getToolDraft<T>(toolUseId: string): T | undefined {
  return conversationStore.getState().toolDrafts[toolUseId] as T | undefined;
}

export function setToolDraft(toolUseId: string, draft: unknown) {
  conversationStore.setState((state) => ({
    toolDrafts: { ...state.toolDrafts, [toolUseId]: draft },
  }));
}

export function clearToolDraft(toolUseId: string) {
  conversationStore.setState((state) => {
    if (!(toolUseId in state.toolDrafts)) {
      return state;
    }
    const { [toolUseId]: _removed, ...toolDrafts } = state.toolDrafts;

    return { toolDrafts };
  });
}

export const useUnreadMessageIds = (agentId: string | null | undefined) =>
  useConversationStore((state) =>
    agentId
      ? (state.unreadMessages[agentId] ?? EMPTY_UNREAD_SET)
      : EMPTY_UNREAD_SET,
  );

export const useIsMessageUnread = (
  agentId: string | null | undefined,
  messageId: string,
): boolean =>
  useConversationStore((state) =>
    agentId ? (state.unreadMessages[agentId]?.has(messageId) ?? false) : false,
  );

export const useAgentHasUnread = (
  agentId: string | null | undefined,
): boolean =>
  useConversationStore((state) =>
    agentId ? (state.unreadMessages[agentId]?.size ?? 0) > 0 : false,
  );

export const useUnreadByAgent = (): Record<string, ReadonlySet<string>> =>
  useConversationStore((state) => state.unreadMessages);

export const useConversation = (agentId: string | null | undefined) =>
  useConversationStore((state) =>
    agentId ? state.conversations[agentId] : undefined,
  );

export const useConversations = () =>
  useConversationStore((state) => state.conversations);

export const useTranscriptWindow = (agentId: string | null | undefined) =>
  useConversationStore((state) =>
    agentId ? state.windows[agentId] : undefined,
  );

/** The first thing the user said — the title until one is generated. */
export function firstUserText(
  conversation: ViewedConversation | undefined,
): string | undefined {
  return (
    conversation?.firstUserText ??
    conversation?.messages.find((m) => m.role === "user")?.textBlocks[0]
  );
}

/**
 * True when the agent has an in-flight Claude subagent — a `Task`/`Agent`
 * tool call that hasn't returned a result yet (and isn't waiting on a
 * permission prompt), or one launched in the background that hasn't reported
 * back. The CLI can report the parent session `idle` between tool calls while
 * its subagents keep working, so this is the live signal
 * that work is still happening under the hood. The host says so for the whole
 * history; a conversation nothing follows is scanned.
 */
function conversationHasRunningSubagents(
  conversation: ViewedConversation | undefined,
): boolean {
  if (!conversation) {
    return false;
  }
  if (conversation.runningSubagents !== undefined) {
    return conversation.runningSubagents;
  }

  return hostHasRunningSubagents(conversation.messages);
}

export const useHasRunningSubagents = (
  agentId: string | null | undefined,
): boolean =>
  useConversationStore((state) =>
    conversationHasRunningSubagents(
      agentId ? state.conversations[agentId] : undefined,
    ),
  );

export const hasRunningSubagents = (agentId: string): boolean =>
  conversationHasRunningSubagents(
    conversationStore.getState().conversations[agentId],
  );

export const getConversationState = () => conversationStore.getState();
export const setConversationState =
  conversationStore.setState.bind(conversationStore);
