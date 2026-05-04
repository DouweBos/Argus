import type { ImageAttachment } from "../lib/ipc";
import type {
  AgentCapabilities,
  LlmContentBlock,
  LlmStreamEvent,
  PermissionRequest,
  SlashCommand,
  TokenUsage,
} from "../lib/types";
import { create } from "zustand";
import { persistLastKnownCapabilities } from "../lib/lastKnownCapabilities";

export interface QueuedMessage {
  id: string;
  images?: ImageAttachment[];
  text: string;
  timestamp: number;
}

export interface TodoItem {
  activeForm?: string;
  content: string;
  status: "completed" | "in_progress" | "pending";
}

export type ToolResultBlock =
  | {
      source: { data: string; media_type: string; type: "base64" };
      type: "image";
    }
  | { text: string; type: "text" };

export type ToolCallChild =
  | { kind: "text"; text: string }
  | { kind: "tool_use"; toolCall: ToolCallInfo };

export interface ToolCallInfo {
  /**
   * Nested events streamed by a sub-agent (Task/Agent). Only populated on
   * parent Task/Agent tool calls whose sub-agent emitted text or tool_use
   * blocks with `parent_tool_use_id === this.id`.
   */
  children?: ToolCallChild[];
  id: string;
  input: Record<string, unknown>;
  isError?: boolean;
  name: string;
  /** Whether this tool call is waiting for user permission. */
  pendingPermission?: boolean;
  /** String for plain text results; array of content blocks for rich results (e.g. images). */
  result?: ToolResultBlock[] | string;
}

/**
 * Describes where a system message came from, so the UI can render it with
 * richer framing (source label, parent agent name, attachments).
 *
 * Today only MCP-originated messages carry a source; future origins (scripts,
 * webhooks, scheduled triggers) can add new `kind` variants.
 */
export interface SystemMessageSource {
  kind: "mcp";
  /** Agent that originated the call, if known. */
  parentAgentId?: string;
  /** Human-readable label for the originating agent (session display name). */
  parentLabel?: string;
  /** MCP tool that injected the message. */
  tool: "send_agent_message" | "spawn_agent" | "spawn_agents_batch";
}

export interface ConversationMessage {
  /**
   * Worktree snapshot captured immediately before this user message was sent
   * to the agent. Set only on user messages, and only when the snapshot
   * succeeded. Lets the user revert all file changes made after this turn.
   */
  checkpointId?: string;
  id: string;
  /** Image attachments accompanying this message. */
  images?: ImageAttachment[];
  /** True for stderr / error system messages (styled differently). */
  isError?: boolean;
  role: "assistant" | "system" | "user";
  /** Origin metadata for system messages (e.g. MCP tool calls). */
  source?: SystemMessageSource;
  textBlocks: string[];
  timestamp: number;
  toolCalls: ToolCallInfo[];
  usage?: TokenUsage;
}

export interface AgentConversation {
  /** Rich capabilities from the initialize control_request response. */
  capabilities?: AgentCapabilities | null;
  /** Tracks the type of the most recent Claude CLI event for thinking-state derivation. */
  lastEventType?: string;
  messages: ConversationMessage[];
  model?: string;
  /** Tool input of the currently executing tool (for richer activity descriptions). */
  pendingToolInput?: Record<string, unknown> | null;
  /** Name of the tool currently executing (awaiting result). Null when thinking/idle. */
  pendingToolName?: string | null;
  /** Messages waiting to be sent when the agent becomes idle. */
  queuedMessages: QueuedMessage[];
  /** When true, skip replayed events from a --resume until the first result. */
  resuming?: boolean;
  /** Claude CLI session ID from the init event, used for --resume. */
  sessionId?: string;
  /** Slash commands — rich objects from initialize, or bare strings from init event. */
  slashCommands?: SlashCommand[];
  /** Generated short title summarising the conversation (async). */
  title?: string;
  /**
   * Latest todo list authored by the agent via TodoWrite. Overwritten on each
   * new TodoWrite call, and set to null when the user dismisses the list.
   * A subsequent TodoWrite repopulates it.
   */
  todos?: TodoItem[] | null;
  tools?: string[];
  totalCost?: number;
  totalDuration?: number;
}

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

function emptyConversation(): AgentConversation {
  return { messages: [], queuedMessages: [] };
}

function extractTodos(toolCalls: ToolCallInfo[]): TodoItem[] | null {
  for (let i = toolCalls.length - 1; i >= 0; i--) {
    const tc = toolCalls[i];
    if (tc.name !== "TodoWrite") {
      continue;
    }
    const todos = (tc.input as { todos?: unknown }).todos;
    if (Array.isArray(todos)) {
      return todos as TodoItem[];
    }
  }

  return null;
}

function findLatestTodosInMessages(
  messages: ConversationMessage[],
): TodoItem[] | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const todos = extractTodos(messages[i].toolCalls);
    if (todos) {
      return todos;
    }
  }

  return null;
}

/**
 * Walk a tool call tree and apply `updater` to the call whose id matches.
 * Returns a new tool call with updated descendants, or null if not found.
 */
function updateToolCallTree(
  tc: ToolCallInfo,
  id: string,
  updater: (tc: ToolCallInfo) => ToolCallInfo,
): ToolCallInfo | null {
  if (tc.id === id) {
    return updater(tc);
  }
  if (!tc.children || tc.children.length === 0) {
    return null;
  }
  let changed = false;
  const nextChildren = tc.children.map((child) => {
    if (child.kind !== "tool_use") {
      return child;
    }
    const updated = updateToolCallTree(child.toolCall, id, updater);
    if (updated) {
      changed = true;

      return { kind: "tool_use" as const, toolCall: updated };
    }

    return child;
  });

  return changed ? { ...tc, children: nextChildren } : null;
}

/**
 * Scan all messages for the tool call with `id`, applying `updater`. Returns
 * new messages array if found (with that tool call updated), or null.
 */
function updateToolCallInMessages(
  messages: ConversationMessage[],
  id: string,
  updater: (tc: ToolCallInfo) => ToolCallInfo,
): ConversationMessage[] | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    let changed = false;
    const nextCalls = msg.toolCalls.map((tc) => {
      const updated = updateToolCallTree(tc, id, updater);
      if (updated) {
        changed = true;

        return updated;
      }

      return tc;
    });
    if (changed) {
      const next = [...messages];
      next[i] = { ...msg, toolCalls: nextCalls };

      return next;
    }
  }

  return null;
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

export function markMessageUnread(agentId: string, messageId: string) {
  conversationStore.setState((state) => {
    const next = addUnreadId(state.unreadMessages, agentId, messageId);
    if (next === state.unreadMessages) {
      return state;
    }

    return { unreadMessages: next };
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

export function appendSystemMessage(agentId: string, msg: ConversationMessage) {
  conversationStore.setState((state) => {
    const existing = state.conversations[agentId] ?? emptyConversation();

    return {
      conversations: {
        ...state.conversations,
        [agentId]: {
          ...existing,
          messages: [...existing.messages, msg],
        },
      },
    };
  });
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

export function queueMessage(
  agentId: string,
  text: string,
  images?: ImageAttachment[],
) {
  conversationStore.setState((state) => {
    const existing = state.conversations[agentId] ?? emptyConversation();
    const queued: QueuedMessage = {
      id: crypto.randomUUID(),
      text,
      images,
      timestamp: Date.now(),
    };

    return {
      conversations: {
        ...state.conversations,
        [agentId]: {
          ...existing,
          queuedMessages: [...existing.queuedMessages, queued],
        },
      },
    };
  });
}

export function removeQueuedMessage(agentId: string, id: string) {
  conversationStore.setState((state) => {
    const existing = state.conversations[agentId];
    if (!existing) {
      return state;
    }
    const next = existing.queuedMessages.filter((m) => m.id !== id);
    if (next.length === existing.queuedMessages.length) {
      return state;
    }

    return {
      conversations: {
        ...state.conversations,
        [agentId]: { ...existing, queuedMessages: next },
      },
    };
  });
}

export function updateQueuedMessage(agentId: string, id: string, text: string) {
  conversationStore.setState((state) => {
    const existing = state.conversations[agentId];
    if (!existing) {
      return state;
    }
    let changed = false;
    const next = existing.queuedMessages.map((m) => {
      if (m.id !== id) {
        return m;
      }
      changed = true;

      return { ...m, text };
    });
    if (!changed) {
      return state;
    }

    return {
      conversations: {
        ...state.conversations,
        [agentId]: { ...existing, queuedMessages: next },
      },
    };
  });
}

export function dequeueMessage(agentId: string): QueuedMessage | undefined {
  let msg: QueuedMessage | undefined;
  conversationStore.setState((state) => {
    const existing = state.conversations[agentId];
    if (!existing || existing.queuedMessages.length === 0) {
      return state;
    }
    const [first, ...rest] = existing.queuedMessages;
    msg = first;

    return {
      conversations: {
        ...state.conversations,
        [agentId]: { ...existing, queuedMessages: rest },
      },
    };
  });

  return msg;
}

export function addUserMessage(
  agentId: string,
  text: string,
  images?: ImageAttachment[],
  checkpointId?: string,
) {
  conversationStore.setState((state) => {
    const existing = state.conversations[agentId] ?? emptyConversation();
    const msg: ConversationMessage = {
      id: crypto.randomUUID(),
      role: "user",
      textBlocks: [text],
      toolCalls: [],
      timestamp: Date.now(),
      images: images?.length ? images : undefined,
      checkpointId,
    };

    return {
      conversations: {
        ...state.conversations,
        [agentId]: {
          ...existing,
          resuming: false,
          lastEventType: "user_sent",
          messages: [...existing.messages, msg],
        },
      },
    };
  });
}

export function appendEvent(agentId: string, event: LlmStreamEvent) {
  conversationStore.setState((state) => {
    const existing = state.conversations[agentId] ?? emptyConversation();

    // When resuming a session, the CLI replays the last turn. Skip those
    // events so we don't duplicate messages. Let the init event through
    // (to refresh session metadata), and clear the flag on the first result.
    if (existing.resuming) {
      if (event.type === "result") {
        return {
          conversations: {
            ...state.conversations,
            [agentId]: { ...existing, resuming: false },
          },
        };
      }

      if (event.type !== "system") {
        return state;
      }
    }

    if (event.type === "system" && event.subtype === "init") {
      const existingByName = new Map<string, SlashCommand>(
        (existing.slashCommands ?? []).map((c) => [c.name, c]),
      );

      const allNames = new Set([
        ...(event.slash_commands ?? []),
        ...(event.skills ?? []),
      ]);
      for (const name of allNames) {
        if (!existingByName.has(name)) {
          existingByName.set(name, {
            name,
            description: "",
            argumentHint: "",
          });
        }
      }

      return {
        conversations: {
          ...state.conversations,
          [agentId]: {
            ...existing,
            lastEventType: event.type,
            model: event.model,
            sessionId: event.session_id,
            tools: event.tools.map((t) => t.name),
            slashCommands: Array.from(existingByName.values()),
          },
        },
      };
    }

    if (event.type === "system" && event.subtype === "session_state_changed") {
      return {
        conversations: {
          ...state.conversations,
          [agentId]: {
            ...existing,
            lastEventType: `system:${event.subtype}:${event.state}`,
          },
        },
      };
    }

    if (event.type === "system" && event.subtype === "api_retry") {
      const retryMsg: ConversationMessage = {
        id: crypto.randomUUID(),
        role: "system",
        textBlocks: [
          `API retry ${event.attempt}/${event.max_retries}` +
            (event.error_status ? ` (HTTP ${event.error_status})` : "") +
            ` — retrying in ${Math.round(event.retry_delay_ms / 1000)}s`,
        ],
        toolCalls: [],
        timestamp: Date.now(),
      };

      return {
        conversations: {
          ...state.conversations,
          [agentId]: {
            ...existing,
            lastEventType: `system:${event.subtype}`,
            messages: [...existing.messages, retryMsg],
          },
        },
      };
    }

    if (event.type === "assistant") {
      const content: LlmContentBlock[] = event.message.content ?? [];

      // Sub-agent messages: nest under the parent Task/Agent tool call.
      if (event.parent_tool_use_id) {
        const parentId = event.parent_tool_use_id;
        const newChildren: ToolCallChild[] = content.map((block) => {
          if (block.type === "text") {
            return { kind: "text", text: block.text };
          }

          return {
            kind: "tool_use",
            toolCall: {
              id: block.id,
              name: block.name,
              input: block.input,
            },
          };
        });
        const nextMessages = updateToolCallInMessages(
          existing.messages,
          parentId,
          (tc) => ({
            ...tc,
            children: [...(tc.children ?? []), ...newChildren],
          }),
        );
        if (!nextMessages) {
          return state;
        }

        return {
          conversations: {
            ...state.conversations,
            [agentId]: {
              ...existing,
              lastEventType: event.type,
              messages: nextMessages,
            },
          },
        };
      }

      const textBlocks: string[] = [];
      const toolCalls: ToolCallInfo[] = [];

      for (const block of content) {
        if (block.type === "text") {
          textBlocks.push(block.text);
        } else if (block.type === "tool_use") {
          toolCalls.push({
            id: block.id,
            name: block.name,
            input: block.input,
          });
        }
      }

      const assistantMsg: ConversationMessage = {
        id: crypto.randomUUID(),
        role: "assistant",
        textBlocks,
        toolCalls,
        timestamp: Date.now(),
        usage: event.message.usage,
      };

      const lastTool =
        toolCalls.length > 0 ? toolCalls[toolCalls.length - 1] : null;

      // Update the agent's todo list whenever a TodoWrite tool call arrives.
      // Later calls overwrite earlier ones so the stored snapshot always
      // reflects the most recent agent-authored state.
      const newTodos = extractTodos(toolCalls);

      // Stash the new assistant message as pending-unread for this turn.
      // It only graduates to the unread set on the `result` event, so an
      // actively-streaming agent doesn't keep re-asserting unread state as
      // each chunk arrives. Tool-call-only turns are skipped — the user has
      // nothing to "read" in those.
      const hasReadable =
        textBlocks.some((t) => t.trim().length > 0) || toolCalls.length === 0;
      const nextPending = hasReadable
        ? addUnreadId(state.pendingUnread, agentId, assistantMsg.id)
        : state.pendingUnread;

      return {
        conversations: {
          ...state.conversations,
          [agentId]: {
            ...existing,
            lastEventType: event.type,
            model: existing.model ?? event.message.model,
            messages: [...existing.messages, assistantMsg],
            pendingToolName: lastTool?.name ?? null,
            pendingToolInput: lastTool?.input ?? null,
            todos: newTodos ?? existing.todos,
          },
        },
        pendingUnread: nextPending,
      };
    }

    if (event.type === "user") {
      const results = event.message.content ?? [];
      if (results.length === 0) {
        return state;
      }

      // Sub-agent tool_results: attach to matching children within the parent.
      if (event.parent_tool_use_id) {
        let messages = existing.messages;
        for (const match of results) {
          const next = updateToolCallInMessages(
            messages,
            match.tool_use_id,
            (tc) => {
              const raw = match.content;
              let result: ToolResultBlock[] | string;
              if (typeof raw === "string") {
                result = raw;
              } else if (Array.isArray(raw)) {
                result = raw as ToolResultBlock[];
              } else {
                result = JSON.stringify(raw, null, 2);
              }
              const isDenyAnswerFlow =
                tc.name === "AskUserQuestion" || tc.name === "ExitPlanMode";

              return {
                ...tc,
                result,
                isError: isDenyAnswerFlow ? false : (match.is_error ?? false),
              };
            },
          );
          if (next) {
            messages = next;
          }
        }
        if (messages === existing.messages) {
          return state;
        }

        return {
          conversations: {
            ...state.conversations,
            [agentId]: {
              ...existing,
              lastEventType: event.type,
              messages,
            },
          },
        };
      }

      const messages = [...existing.messages];
      for (let i = messages.length - 1; i >= 0; i--) {
        if (messages[i].role === "assistant") {
          const updated: ConversationMessage = {
            ...messages[i],
            toolCalls: messages[i].toolCalls.map((tc) => {
              const match = results.find((r) => r.tool_use_id === tc.id);
              if (!match) {
                return tc;
              }
              const raw = match.content;
              let result: ToolResultBlock[] | string;
              if (typeof raw === "string") {
                result = raw;
              } else if (Array.isArray(raw)) {
                result = raw as ToolResultBlock[];
              } else {
                result = JSON.stringify(raw, null, 2);
              }

              // AskUserQuestion and ExitPlanMode use a deny-with-message
              // pattern to pass the user's answer back — the CLI marks the
              // resulting tool_result as is_error, but from the user's POV it's
              // a successful answer, not a failure.
              const isDenyAnswerFlow =
                tc.name === "AskUserQuestion" || tc.name === "ExitPlanMode";

              return {
                ...tc,
                result,
                isError: isDenyAnswerFlow ? false : (match.is_error ?? false),
              };
            }),
          };
          messages[i] = updated;
          break;
        }
      }

      return {
        conversations: {
          ...state.conversations,
          [agentId]: {
            ...existing,
            lastEventType: event.type,
            messages,
            pendingToolName: null,
            pendingToolInput: null,
          },
        },
      };
    }

    if (event.type === "result") {
      const newTotal = (existing.totalCost ?? 0) + (event.total_cost_usd ?? 0);
      const newDuration =
        (existing.totalDuration ?? 0) + (event.duration_ms ?? 0);

      // pendingUnread is flushed when the agent actually transitions to idle
      // (see flushPendingUnread). A `result` only marks the end of a single
      // turn — if a queued message drains immediately, the agent goes back to
      // running and shouldn't show an unread badge yet.

      return {
        conversations: {
          ...state.conversations,
          [agentId]: {
            ...existing,
            lastEventType: event.type,
            pendingToolName: null,
            pendingToolInput: null,
            totalCost: newTotal,
            totalDuration: newDuration,
          },
        },
      };
    }

    return state;
  });
}

export function setCapabilities(
  agentId: string,
  capabilities: AgentCapabilities,
) {
  conversationStore.setState((state) => {
    const existing = state.conversations[agentId] ?? emptyConversation();

    return {
      conversations: {
        ...state.conversations,
        [agentId]: {
          ...existing,
          capabilities,
          slashCommands: capabilities.commands,
        },
      },
    };
  });
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
  conversationStore.setState((state) => {
    const existing = state.conversations[agentId] ?? emptyConversation();

    return {
      conversations: {
        ...state.conversations,
        [agentId]: { ...existing, model },
      },
    };
  });
}

export function setPermissionPending(
  agentId: string,
  request: PermissionRequest,
): boolean {
  let found = false;
  conversationStore.setState((state) => {
    const existing = state.conversations[agentId];
    if (!existing) {
      return state;
    }

    const messages = [...existing.messages];
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role !== "assistant") {
        continue;
      }
      const idx = messages[i].toolCalls.findIndex(
        (tc) => tc.id === request.tool_use_id,
      );
      if (idx === -1) {
        continue;
      }

      const updated = { ...messages[i] };
      updated.toolCalls = [...updated.toolCalls];
      updated.toolCalls[idx] = {
        ...updated.toolCalls[idx],
        pendingPermission: true,
      };
      messages[i] = updated;
      found = true;
      break;
    }

    if (!found) {
      return state;
    }

    return {
      conversations: {
        ...state.conversations,
        [agentId]: { ...existing, messages },
      },
    };
  });

  return found;
}

export function clearPermission(agentId: string, toolUseId: string) {
  conversationStore.setState((state) => {
    const existing = state.conversations[agentId];
    if (!existing) {
      return state;
    }

    const messages = [...existing.messages];
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role !== "assistant") {
        continue;
      }
      const idx = messages[i].toolCalls.findIndex((tc) => tc.id === toolUseId);
      if (idx === -1) {
        continue;
      }

      const updated = { ...messages[i] };
      updated.toolCalls = [...updated.toolCalls];
      updated.toolCalls[idx] = {
        ...updated.toolCalls[idx],
        pendingPermission: false,
      };
      messages[i] = updated;
      break;
    }

    return {
      conversations: {
        ...state.conversations,
        [agentId]: { ...existing, messages },
      },
    };
  });
}

export function cancelPermission(agentId: string, toolUseId: string) {
  conversationStore.setState((state) => {
    const existing = state.conversations[agentId];
    if (!existing) {
      return state;
    }

    const messages = [...existing.messages];
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role !== "assistant") {
        continue;
      }
      const idx = messages[i].toolCalls.findIndex((tc) => tc.id === toolUseId);
      if (idx === -1) {
        continue;
      }

      const updated = { ...messages[i] };
      updated.toolCalls = [...updated.toolCalls];
      updated.toolCalls[idx] = {
        ...updated.toolCalls[idx],
        pendingPermission: false,
      };
      messages[i] = updated;
      break;
    }

    return {
      conversations: {
        ...state.conversations,
        [agentId]: { ...existing, messages },
      },
    };
  });
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
      [agentId]: {
        messages,
        queuedMessages: [],
        model,
        sessionId,
        resuming,
        title,
        todos: findLatestTodosInMessages(messages),
      },
    },
  }));
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

export const getConversationState = () => conversationStore.getState();
export const setConversationState =
  conversationStore.setState.bind(conversationStore);
