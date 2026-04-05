import { create } from "zustand";
import type {
  AgentCapabilities,
  ClaudeStreamEvent,
  ClaudeContentBlock,
  PermissionRequest,
  SlashCommand,
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

interface ConversationState {
  addUserMessage: (agentId: string, text: string) => void;
  appendEvent: (agentId: string, event: ClaudeStreamEvent) => void;
  /** Cancel a pending permission prompt (CLI withdrew the request). */
  cancelPermission: (agentId: string, toolUseId: string) => void;
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
  /** Store capabilities from the initialize control_request response. */
  setCapabilities: (agentId: string, capabilities: AgentCapabilities) => void;
  /** Update the model for a conversation (after a set_model control request). */
  setModel: (agentId: string, model: string) => void;
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
        // Merge slash_commands and skills from the init event with any
        // richer data already received from the initialize control_request.
        // The init event provides bare string names; we convert them to
        // SlashCommand objects but preserve existing entries with descriptions.
        const existingByName = new Map<string, SlashCommand>(
          (existing.slashCommands ?? []).map((c) => [c.name, c]),
        );

        // Add commands and skills from the init event (bare names).
        const allNames = new Set([
          ...(event.slash_commands ?? []),
          ...(event.skills ?? []),
        ]);
        for (const name of allNames) {
          if (!existingByName.has(name)) {
            existingByName.set(name, { name, description: "", argumentHint: "" });
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

      // session_state_changed — track as lastEventType for UI derivation.
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

      // api_retry — add a transient system message so the user knows about retries.
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

        // Track the last tool_use block as the "pending tool" for activity display.
        const lastTool = toolCalls.length > 0 ? toolCalls[toolCalls.length - 1] : null;

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
            [agentId]: {
              ...existing,
              lastEventType: event.type,
              messages,
              // Tool result arrived — clear pending tool so activity shows "Thinking".
              pendingToolName: null,
              pendingToolInput: null,
            },
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
              pendingToolName: null,
              pendingToolInput: null,
              totalCost: newTotal,
              totalDuration: newDuration,
            },
          },
        };
      }

      return state;
    }),

  setCapabilities: (agentId, capabilities) =>
    set((state) => {
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
    }),

  setModel: (agentId, model) =>
    set((state) => {
      const existing = state.conversations[agentId] ?? emptyConversation();
      return {
        conversations: {
          ...state.conversations,
          [agentId]: { ...existing, model },
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

  cancelPermission: (agentId, toolUseId) =>
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
