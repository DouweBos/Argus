import { create } from "zustand";
import type {
  ClaudeStreamEvent,
  ClaudeContentBlock,
  PermissionRequest,
  TokenUsage,
} from "../lib/types";
import type { ImageAttachment } from "../lib/ipc";

export interface QueuedMessage {
  id: string;
  images?: ImageAttachment[];
  text: string;
  timestamp: number;
}

export interface ToolCallInfo {
  id: string;
  input: Record<string, unknown>;
  isError?: boolean;
  name: string;
  /** Whether this tool call is waiting for user permission. */
  pendingPermission?: boolean;
  result?: string;
}

export interface ConversationMessage {
  id: string;
  role: "assistant" | "system" | "user";
  textBlocks: string[];
  timestamp: number;
  toolCalls: ToolCallInfo[];
  usage?: TokenUsage;
}

export interface AgentConversation {
  /** When true, suppress assistant/user events from the bootstrap prompt. */
  bootstrapping?: boolean;
  /** Tracks the type of the most recent Claude CLI event for thinking-state derivation. */
  lastEventType?: string;
  messages: ConversationMessage[];
  model?: string;
  /** Messages waiting to be sent when the agent becomes idle. */
  queuedMessages: QueuedMessage[];
  /** When true, skip replayed events from a --resume until the first result. */
  resuming?: boolean;
  /** Claude CLI session ID from the init event, used for --resume. */
  sessionId?: string;
  slashCommands?: string[];
  tools?: string[];
  totalCost?: number;
  totalDuration?: number;
}

interface ConversationState {
  addUserMessage: (agentId: string, text: string) => void;
  appendEvent: (agentId: string, event: ClaudeStreamEvent) => void;
  clearConversation: (agentId: string) => void;
  /** Clear the pendingPermission flag on a tool call after user responds. */
  clearPermission: (agentId: string, toolUseId: string) => void;
  conversations: Record<string, AgentConversation>;
  /** Remove and return the next queued message for an agent. */
  dequeueMessage: (agentId: string) => QueuedMessage | undefined;
  /** Re-key a conversation from one agent ID to another (e.g. after restart). */
  migrateConversation: (oldAgentId: string, newAgentId: string) => void;
  /** Add a message to the queue (sent when the agent becomes idle). */
  queueMessage: (
    agentId: string,
    text: string,
    images?: ImageAttachment[],
  ) => void;
  /** Mark a conversation as bootstrapping (suppress assistant/user events). */
  setBootstrapping: (agentId: string, bootstrapping: boolean) => void;
  /** Mark a tool call as pending permission so the UI shows Allow/Deny.
   *  Returns true if the tool call was found, false otherwise. */
  setPermissionPending: (
    agentId: string,
    request: PermissionRequest,
  ) => boolean;
}

function emptyConversation(): AgentConversation {
  return { messages: [], queuedMessages: [] };
}

export const useConversationStore = create<ConversationState>((set) => ({
  conversations: {},

  clearConversation: (agentId) =>
    set((state) => {
      const next = { ...state.conversations };
      delete next[agentId];
      return { conversations: next };
    }),

  migrateConversation: (oldAgentId, newAgentId) =>
    set((state) => {
      const existing = state.conversations[oldAgentId];
      if (!existing) return state;
      const next = { ...state.conversations };
      delete next[oldAgentId];
      next[newAgentId] = { ...existing, resuming: true };
      return { conversations: next };
    }),

  queueMessage: (agentId, text, images) =>
    set((state) => {
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
    }),

  dequeueMessage: (agentId) => {
    let msg: QueuedMessage | undefined;
    set((state) => {
      const existing = state.conversations[agentId];
      if (!existing || existing.queuedMessages.length === 0) return state;
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
  },

  addUserMessage: (agentId, text) =>
    set((state) => {
      const existing = state.conversations[agentId] ?? emptyConversation();
      const msg: ConversationMessage = {
        id: crypto.randomUUID(),
        role: "user",
        textBlocks: [text],
        toolCalls: [],
        timestamp: Date.now(),
      };
      return {
        conversations: {
          ...state.conversations,
          [agentId]: {
            ...existing,
            lastEventType: "user_sent",
            messages: [...existing.messages, msg],
          },
        },
      };
    }),

  appendEvent: (agentId, event) =>
    set((state) => {
      const existing = state.conversations[agentId] ?? emptyConversation();

      // During bootstrap, suppress assistant/user events (the response to
      // the hidden init prompt). Let system and result events through.
      // The result event clears the flag so subsequent turns render normally.
      if (existing.bootstrapping) {
        if (event.type === "result") {
          return {
            conversations: {
              ...state.conversations,
              [agentId]: { ...existing, bootstrapping: false },
            },
          };
        }
        if (event.type !== "system") {
          return state;
        }
      }

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
        return {
          conversations: {
            ...state.conversations,
            [agentId]: {
              ...existing,
              lastEventType: event.type,
              model: event.model,
              sessionId: event.session_id,
              tools: event.tools.map((t) => t.name),
              slashCommands: event.slash_commands,
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

        return {
          conversations: {
            ...state.conversations,
            [agentId]: {
              ...existing,
              lastEventType: event.type,
              model: existing.model ?? event.message.model,
              messages: [...existing.messages, assistantMsg],
            },
          },
        };
      }

      if (event.type === "user") {
        // Tool results from the backend — attach to matching tool calls
        const results = event.message.content ?? [];
        if (results.length === 0) return state;

        const messages = [...existing.messages];
        for (let i = messages.length - 1; i >= 0; i--) {
          if (messages[i].role === "assistant") {
            const updated: ConversationMessage = {
              ...messages[i],
              toolCalls: messages[i].toolCalls.map((tc) => {
                const match = results.find((r) => r.tool_use_id === tc.id);
                if (!match) return tc;
                const raw = match.content;
                const result =
                  typeof raw === "string" ? raw : JSON.stringify(raw, null, 2);
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
            [agentId]: { ...existing, lastEventType: event.type, messages },
          },
        };
      }

      if (event.type === "result") {
        // Accumulate cost/duration in the footer — no inline message
        const newTotal =
          (existing.totalCost ?? 0) + (event.total_cost_usd ?? 0);
        const newDuration =
          (existing.totalDuration ?? 0) + (event.duration_ms ?? 0);

        return {
          conversations: {
            ...state.conversations,
            [agentId]: {
              ...existing,
              lastEventType: event.type,
              totalCost: newTotal,
              totalDuration: newDuration,
            },
          },
        };
      }

      return state;
    }),

  setBootstrapping: (agentId, bootstrapping) =>
    set((state) => {
      const existing = state.conversations[agentId] ?? emptyConversation();
      return {
        conversations: {
          ...state.conversations,
          [agentId]: { ...existing, bootstrapping },
        },
      };
    }),

  setPermissionPending: (agentId, request) => {
    let found = false;
    set((state) => {
      const existing = state.conversations[agentId];
      if (!existing) return state;

      // Walk backward to find the tool call with matching id.
      const messages = [...existing.messages];
      for (let i = messages.length - 1; i >= 0; i--) {
        if (messages[i].role !== "assistant") continue;
        const idx = messages[i].toolCalls.findIndex(
          (tc) => tc.id === request.tool_use_id,
        );
        if (idx === -1) continue;

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

      if (!found) return state;

      return {
        conversations: {
          ...state.conversations,
          [agentId]: { ...existing, messages },
        },
      };
    });
    return found;
  },

  clearPermission: (agentId, toolUseId) =>
    set((state) => {
      const existing = state.conversations[agentId];
      if (!existing) return state;

      const messages = [...existing.messages];
      for (let i = messages.length - 1; i >= 0; i--) {
        if (messages[i].role !== "assistant") continue;
        const idx = messages[i].toolCalls.findIndex(
          (tc) => tc.id === toolUseId,
        );
        if (idx === -1) continue;

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
    }),
}));
