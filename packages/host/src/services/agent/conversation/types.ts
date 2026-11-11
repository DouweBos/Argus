/**
 * The conversation model every Argus client folds an agent's stream into, and
 * the Claude Code stream-json events it is folded from. Its JSON is the
 * transcript snapshot the gateway serves.
 */

import type {
  AgentCapabilities,
  ConversationBackgroundTask as BackgroundTask,
  ConversationHandoff,
  AgentSlashCommand as SlashCommand,
  ImageAttachment,
} from "@argus/remote-protocol";

export type {
  AgentCapabilities,
  BackgroundTask,
  ImageAttachment,
  SlashCommand,
};

// ---------------------------------------------------------------------------
// Claude Code stream-json event types
// ---------------------------------------------------------------------------

export type LlmStreamEvent =
  | {
      /** A background task (or a foreground one being tracked) began. */
      is_backgrounded?: boolean;
      subtype: "task_started";
      task_id: string;
      tool_use_id?: string;
      type: "system";
    }
  | {
      /** A task settled. `usage` is set for subagents. */
      status: "completed" | "failed" | "stopped";
      subtype: "task_notification";
      task_id: string;
      tool_use_id?: string;
      type: "system";
      usage?: { duration_ms?: number };
    }
  | {
      /** Authoritative idle/running signal from the CLI. */
      state: "idle" | "requires_action" | "running";
      subtype: "session_state_changed";
      type: "system";
    }
  | {
      /** Emitted when an API request fails with a retryable error. */
      attempt: number;
      error_status: number | null;
      max_retries: number;
      retry_delay_ms: number;
      subtype: "api_retry";
      type: "system";
    }
  | {
      /** Generic status update from the CLI. */
      status: string;
      subtype: "status";
      type: "system";
    }
  | {
      duration_ms: number;
      /** Per-model usage; each entry carries the CLI's `contextWindow`. */
      modelUsage?: Record<string, { contextWindow?: number }>;
      result?: string;
      subtype: "error" | "success";
      total_cost_usd: number;
      type: "result";
      usage: TokenUsage;
    }
  | {
      message: {
        content: LlmContentBlock[];
        model: string;
        usage: TokenUsage;
      };
      /** Present when this assistant message is from a sub-agent (Task/Agent tool). */
      parent_tool_use_id?: string | null;
      type: "assistant";
    }
  | {
      message: { content: LlmToolResult[] };
      /** Present when this tool_result is from a sub-agent (Task/Agent tool). */
      parent_tool_use_id?: string | null;
      type: "user";
    }
  | {
      model: string;
      session_id: string;
      /** Skills specifically (plugins, user settings, bundled). */
      skills?: string[];
      /** All user-invocable commands (built-in + skills + plugins). */
      slash_commands?: string[];
      subtype: "init";
      tools: { name: string }[];
      type: "system";
    };

export type LlmContentBlock =
  | {
      id: string;
      input: Record<string, unknown>;
      name: string;
      type: "tool_use";
    }
  | { text: string; type: "text" }
  | { thinking?: string; type: "redacted_thinking" | "thinking" };

export interface LlmToolResult {
  /** May be a plain string or a structured content block from the Claude API. */
  content: unknown;
  is_error?: boolean;
  tool_use_id: string;
  type: "tool_result";
}

export interface TokenUsage {
  cache_creation_input_tokens?: number;
  cache_read_input_tokens?: number;
  input_tokens: number;
  output_tokens: number;
}

// ---------------------------------------------------------------------------
// Permission request (from control protocol via IPC event)
// ---------------------------------------------------------------------------

export interface PermissionSuggestion {
  prefix?: string;
  tool: string;
  type: string;
}

export interface PermissionRequest {
  /** Permission suggestions from the CLI (e.g. "always allow Edit in /src"). */
  permission_suggestions?: PermissionSuggestion[];
  /** Control protocol request_id — needed for the response round-trip. */
  request_id: string;
  tool_input: Record<string, unknown>;
  tool_name: string;
  tool_use_id: string;
}

/** Emitted when the CLI withdraws a pending permission request. */
export interface PermissionCancellation {
  request_id: string;
  tool_use_id: string;
}

// ---------------------------------------------------------------------------
// Conversation
// ---------------------------------------------------------------------------

export interface TodoItem {
  activeForm?: string;
  content: string;
  status: "completed" | "in_progress" | "pending";
}

export interface Task {
  activeForm?: string;
  blockedBy?: string[];
  blocks?: string[];
  description?: string;
  id: string;
  metadata?: Record<string, unknown>;
  owner?: string;
  status: "completed" | "in_progress" | "pending";
  subject: string;
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
  /** Set on a call that keeps running after its tool_result (`run_in_background`). */
  background?: BackgroundTask;
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
  tool:
    | "create_session"
    | "send_agent_message"
    | "spawn_agent"
    | "spawn_agents_batch";
}

export interface ConversationMessage {
  /**
   * Who sent this user message when it wasn't the local user — a huddle guest's
   * chosen name. Absent for the engineer's own sends.
   */
  author?: string;
  /**
   * Worktree snapshot captured immediately before this user message was sent
   * to the agent. Set only on user messages, and only when the snapshot
   * succeeded. Lets the user revert all file changes made after this turn.
   */
  checkpointId?: string;
  /** Set on the divider a "Continue on…" leaves at the top of the new chat. */
  handoff?: ConversationHandoff;
  id: string;
  /** Image attachments accompanying this message. */
  images?: ImageAttachment[];
  role: "assistant" | "system" | "user";
  /** Origin metadata for system messages (e.g. MCP tool calls). */
  source?: SystemMessageSource;
  textBlocks: string[];
  timestamp: number;
  /** Severity of a system message — stderr is an error, a CLI diagnostic a warning. */
  tone?: "error" | "warning";
  toolCalls: ToolCallInfo[];
  usage?: TokenUsage;
}

export interface AgentConversation {
  /** Rich capabilities from the initialize control_request response. */
  capabilities?: AgentCapabilities | null;
  /** Context window the CLI reported on its last `result`, in tokens. */
  contextWindow?: number;
  /**
   * Replies the user might send next, suggested by a small model once a turn
   * ends. Cleared as soon as the next message goes in.
   */
  followUps?: string[];
  /** Tracks the type of the most recent Claude CLI event for thinking-state derivation. */
  lastEventType?: string;
  messages: ConversationMessage[];
  model?: string;
  /** Tool input of the currently executing tool (for richer activity descriptions). */
  pendingToolInput?: Record<string, unknown> | null;
  /** Name of the tool currently executing (awaiting result). Null when thinking/idle. */
  pendingToolName?: string | null;
  /** Messages waiting to be sent when the agent becomes idle. */
  /** When true, skip replayed events from a --resume until the first result. */
  resuming?: boolean;
  /** Claude CLI session ID from the init event, used for --resume. */
  sessionId?: string;
  /** Slash commands — rich objects from initialize, or bare strings from init event. */
  slashCommands?: SlashCommand[];
  /**
   * Stable creation order of `tasks` ids so the list renders deterministically
   * across re-folds. Tasks marked `deleted` are removed from both maps.
   */
  taskOrder?: string[];
  /**
   * Task list authored via the stateful Task* tool family (TaskCreate /
   * TaskUpdate / TaskList / TaskGet). Folded from tool inputs + results across
   * the message history. `null` when the user dismisses; a subsequent Task*
   * call repopulates it.
   */
  tasks?: Record<string, Task> | null;
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
