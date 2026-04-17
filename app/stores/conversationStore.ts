import type { ImageAttachment } from "../lib/ipc";
import type {
  AgentCapabilities,
  ClaudeContentBlock,
  ClaudeStreamEvent,
  PermissionRequest,
  SlashCommand,
  TokenUsage,
} from "../lib/types";
import { create } from "zustand";

export interface QueuedMessage {
  id: string;
  images?: ImageAttachment[];
  text: string;
  timestamp: number;
}

export type ToolResultBlock =
  | {
      source: { data: string; media_type: string; type: "base64" };
      type: "image";
    }
  | { text: string; type: "text" };

export interface ToolCallInfo {
  id: string;
  input: Record<string, unknown>;
  isError?: boolean;
  name: string;
  /** Whether this tool call is waiting for user permission. */
  pendingPermission?: boolean;
  /** String for plain text results; array of content blocks for rich results (e.g. images). */
  result?: ToolResultBlock[] | string;
}

export interface ConversationMessage {
  id: string;
  /** Image attachments the user sent alongside this message (user role only). */
  images?: ImageAttachment[];
  /** True for stderr / error system messages (styled differently). */
  isError?: boolean;
  role: "assistant" | "system" | "user";
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
  tools?: string[];
  totalCost?: number;
  totalDuration?: number;
}

interface ConversationStoreData {
  conversations: Record<string, AgentConversation>;
}

function emptyConversation(): AgentConversation {
  return { messages: [], queuedMessages: [] };
}

const conversationStore = create<ConversationStoreData>(() => ({
  conversations: {},
}));

const useConversationStore = conversationStore;

export function clearConversation(agentId: string) {
  conversationStore.setState((state) => {
    const next = { ...state.conversations };
    delete next[agentId];

    return { conversations: next };
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
    const next = { ...state.conversations };
    delete next[oldAgentId];
    next[newAgentId] = { ...existing, resuming: true };

    return { conversations: next };
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

export function appendEvent(agentId: string, event: ClaudeStreamEvent) {
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
      const content: ClaudeContentBlock[] = event.message.content ?? [];
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
          },
        },
      };
    }

    if (event.type === "user") {
      const results = event.message.content ?? [];
      if (results.length === 0) {
        return state;
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

              return {
                ...tc,
                result,
                isError: match.is_error ?? false,
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
      },
    },
  }));
}

export const useConversation = (agentId: string | null | undefined) =>
  useConversationStore((state) =>
    agentId ? state.conversations[agentId] : undefined,
  );

export const useConversations = () =>
  useConversationStore((state) => state.conversations);

export const getConversationState = () => conversationStore.getState();
export const setConversationState =
  conversationStore.setState.bind(conversationStore);
