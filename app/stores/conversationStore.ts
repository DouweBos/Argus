import type { ImageAttachment } from "../lib/ipc";
import type {
  AgentCapabilities,
  AgentConversation,
  ConversationMessage,
  LlmStreamEvent,
  PermissionRequest,
} from "@argus/host/services/agent/conversation/types";
import { create } from "zustand";
import { contextWindowFromModelUsage } from "@argus/host/services/agent/contextWindow";
import {
  emptyConversation,
  fromSavedMessages,
  reduceEvent,
  withCapabilities,
  withInjectedPrompt,
  withPermissionPending,
  withSystemMessage,
  withUserMessage,
} from "@argus/host/services/agent/conversation/reducer";
import { rememberContextWindow } from "../lib/contextWindow";
import { persistLastKnownCapabilities } from "../lib/lastKnownCapabilities";

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

export interface PendingImage {
  attachment: ImageAttachment;
  name: string;
  previewUrl: string;
}

interface ConversationStoreData {
  conversations: Record<string, AgentConversation>;
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
}

const conversationStore = create<ConversationStoreData>(() => ({
  conversations: {},
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

    return {
      conversations: next,
      unreadMessages: nextUnread,
      pendingUnread: nextPending,
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

/** Apply a pure update to one agent's conversation, creating it if needed. */
function updateConversation(
  agentId: string,
  update: (existing: AgentConversation) => AgentConversation,
) {
  conversationStore.setState((state) => {
    const existing = state.conversations[agentId] ?? emptyConversation();
    const next = update(existing);
    if (next === existing) {
      return state;
    }

    return { conversations: { ...state.conversations, [agentId]: next } };
  });
}

export function appendSystemMessage(agentId: string, msg: ConversationMessage) {
  updateConversation(agentId, (c) => withSystemMessage(c, msg));
}

/**
 * A prompt sent on the agent's behalf (spawn_agent, send_agent_message). Like a
 * typed message it starts a new turn, so nothing after it is a --resume replay.
 */
export function appendInjectedPrompt(
  agentId: string,
  msg: ConversationMessage,
) {
  updateConversation(agentId, (c) => withInjectedPrompt(c, msg));
}

export function migrateConversation(oldAgentId: string, newAgentId: string) {
  conversationStore.setState((state) => {
    const existing = state.conversations[oldAgentId];
    if (!existing) {
      return state;
    }
    const { [oldAgentId]: _removed, ...rest } = state.conversations;
    const next = { ...rest, [newAgentId]: { ...existing, resuming: true } };

    const oldUnread = state.unreadMessages[oldAgentId];
    let unreadMessages = state.unreadMessages;
    if (oldUnread) {
      const { [oldAgentId]: _droppedUnread, ...remaining } =
        state.unreadMessages;
      unreadMessages = { ...remaining, [newAgentId]: oldUnread };
    }

    const oldPending = state.pendingUnread[oldAgentId];
    let pendingUnread = state.pendingUnread;
    if (oldPending) {
      const { [oldAgentId]: _droppedPending, ...remainingPending } =
        state.pendingUnread;
      pendingUnread = { ...remainingPending, [newAgentId]: oldPending };
    }

    return { conversations: next, unreadMessages, pendingUnread };
  });
}
export function addUserMessage(
  agentId: string,
  text: string,
  images?: ImageAttachment[],
  checkpointId?: string,
  author?: string,
) {
  updateConversation(agentId, (c) =>
    withUserMessage(c, text, { images, checkpointId, author }),
  );
}

export function appendEvent(agentId: string, event: LlmStreamEvent) {
  conversationStore.setState((state) => {
    const existing = state.conversations[agentId] ?? emptyConversation();
    const next = reduceEvent(existing, event);
    if (next === existing) {
      return state;
    }
    if (event.type === "result" && next.model) {
      const size = contextWindowFromModelUsage(
        event.modelUsage,
        existing.model,
      );
      if (size) {
        rememberContextWindow(next.model, size);
      }
    }

    // A new assistant message is pending-unread for this turn, graduating to
    // unread only once the agent goes idle — so a streaming agent doesn't keep
    // re-asserting unread state. Tool-call-only messages have nothing to read.
    const added =
      next.messages.length > existing.messages.length
        ? next.messages[next.messages.length - 1]
        : null;
    const readable =
      event.type === "assistant" &&
      added?.role === "assistant" &&
      (added.textBlocks.some((t) => t.trim().length > 0) ||
        added.toolCalls.length === 0);

    return {
      conversations: { ...state.conversations, [agentId]: next },
      ...(readable && added
        ? { pendingUnread: addUnreadId(state.pendingUnread, agentId, added.id) }
        : {}),
    };
  });
}

export function setCapabilities(
  agentId: string,
  capabilities: AgentCapabilities,
) {
  updateConversation(agentId, (c) => withCapabilities(c, capabilities));
  // Cache to localStorage so the start-agent / new-session dialogs can show
  // a real model + slash-command list immediately on the next launch,
  // without waiting for an agent to spawn first.
  persistLastKnownCapabilities({
    models: capabilities.models?.map((m) => ({
      value: m.value,
      displayName: m.displayName,
      description: m.description,
    })),
    slashCommands: capabilities.commands,
  });
}

export function setModel(agentId: string, model: string) {
  updateConversation(agentId, (c) => ({ ...c, model }));
}

/** Walks the full tool-call tree: a subagent's call nests under its parent. */
function setPermissionFlag(
  agentId: string,
  toolUseId: string,
  pending: boolean,
): boolean {
  let found = false;
  conversationStore.setState((state) => {
    const existing = state.conversations[agentId];
    const next = existing
      ? withPermissionPending(existing, toolUseId, pending)
      : null;
    if (!next) {
      return state;
    }
    found = true;

    return { conversations: { ...state.conversations, [agentId]: next } };
  });

  return found;
}

export function setPermissionPending(
  agentId: string,
  request: PermissionRequest,
): boolean {
  return setPermissionFlag(agentId, request.tool_use_id, true);
}

export function clearPermission(agentId: string, toolUseId: string) {
  setPermissionFlag(agentId, toolUseId, false);
}

export function cancelPermission(agentId: string, toolUseId: string) {
  setPermissionFlag(agentId, toolUseId, false);
}

export function loadSavedMessages(
  agentId: string,
  messages: ConversationMessage[],
  model?: string,
  sessionId?: string,
  resuming?: boolean,
  title?: string,
) {
  conversationStore.setState((state) => ({
    conversations: {
      ...state.conversations,
      [agentId]: fromSavedMessages(messages, {
        model,
        sessionId,
        resuming,
        title,
      }),
    },
  }));
}

export function clearAgentTasks(agentId: string) {
  conversationStore.setState((state) => {
    const existing = state.conversations[agentId];
    if (!existing) {
      return state;
    }

    return {
      conversations: {
        ...state.conversations,
        [agentId]: { ...existing, tasks: null, taskOrder: undefined },
      },
    };
  });
}

export function clearAgentTodos(agentId: string) {
  conversationStore.setState((state) => {
    const existing = state.conversations[agentId];
    if (!existing) {
      return state;
    }

    return {
      conversations: {
        ...state.conversations,
        [agentId]: { ...existing, todos: null },
      },
    };
  });
}

export function setConversationTitle(agentId: string, title: string) {
  conversationStore.setState((state) => {
    const existing = state.conversations[agentId];
    if (!existing) {
      return state;
    }

    return {
      conversations: {
        ...state.conversations,
        [agentId]: { ...existing, title },
      },
    };
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

/**
 * True when the agent has an in-flight Claude subagent — a `Task`/`Agent`
 * tool call that hasn't returned a result yet (and isn't waiting on a
 * permission prompt). The CLI can report the parent session `idle` between
 * tool calls while its subagents keep working, so this is the live signal
 * that work is still happening under the hood.
 */
function conversationHasRunningSubagents(
  conversation: AgentConversation | undefined,
): boolean {
  if (!conversation) {
    return false;
  }
  const { messages } = conversation;
  for (let i = messages.length - 1; i >= 0; i--) {
    for (const tc of messages[i].toolCalls) {
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
