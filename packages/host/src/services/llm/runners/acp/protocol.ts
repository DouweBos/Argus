/**
 * The slice of the Agent Client Protocol (v1) Argus speaks: JSON-RPC 2.0 over
 * the agent's stdio. https://agentclientprotocol.com
 */

export const ACP_PROTOCOL_VERSION = 1;

/** `session/new` fails with this when the agent needs `authenticate` first. */
export const ACP_AUTH_REQUIRED = -32000;

export interface AcpAuthMethod {
  id: string;
  name: string;
  description?: string | null;
  type?: string;
}

export interface AcpInitializeResult {
  protocolVersion: number;
  agentInfo?: { name?: string; version?: string };
  authMethods?: AcpAuthMethod[];
  agentCapabilities?: {
    loadSession?: boolean;
    promptCapabilities?: {
      image?: boolean;
      audio?: boolean;
      embeddedContext?: boolean;
    };
    mcpCapabilities?: { http?: boolean; sse?: boolean };
    sessionCapabilities?: { resume?: unknown };
  };
}

export interface AcpMode {
  id: string;
  name: string;
  description?: string | null;
}

export interface AcpModelInfo {
  modelId: string;
  name: string;
  description?: string | null;
}

export interface AcpConfigSelectOption {
  value: string;
  name: string;
  description?: string | null;
}

/** A session setting the agent exposes (model, mode, thought level, ...). */
export interface AcpConfigOption {
  id: string;
  name: string;
  category?: string | null;
  type: string;
  currentValue?: unknown;
  /** Flat, or grouped as `{ group, name, options }`. */
  options?: (AcpConfigSelectOption | { options: AcpConfigSelectOption[] })[];
}

export interface AcpSessionResult {
  sessionId?: string;
  modes?: { currentModeId: string; availableModes: AcpMode[] } | null;
  models?: { currentModelId: string; availableModels: AcpModelInfo[] } | null;
  configOptions?: AcpConfigOption[] | null;
}

export type AcpContentBlock =
  | {
      type: "resource";
      resource: { uri: string; text?: string; blob?: string };
    }
  | { type: "image"; data: string; mimeType: string; uri?: string }
  | { type: "resource_link"; uri: string; name: string }
  | { type: "text"; text: string }
  | { type: string; [key: string]: unknown };

export type AcpToolKind =
  | "delete"
  | "edit"
  | "execute"
  | "fetch"
  | "move"
  | "other"
  | "read"
  | "search"
  | "switch_mode"
  | "think";

export type AcpToolStatus = "completed" | "failed" | "in_progress" | "pending";

export type AcpToolContent =
  | { type: "content"; content: AcpContentBlock }
  | { type: "diff"; path: string; oldText?: string | null; newText: string }
  | { type: "terminal"; terminalId: string };

export interface AcpToolCall {
  toolCallId: string;
  title?: string;
  kind?: AcpToolKind;
  status?: AcpToolStatus;
  content?: AcpToolContent[] | null;
  locations?: { path: string; line?: number | null }[] | null;
  rawInput?: unknown;
  rawOutput?: unknown;
}

export interface AcpPlanEntry {
  content: string;
  priority?: string;
  status: "completed" | "in_progress" | "pending";
}

export type AcpSessionUpdate =
  | {
      sessionUpdate: "usage_update";
      used?: number;
      size?: number;
      cost?: { amount?: number; currency?: string } | null;
    }
  | { sessionUpdate: "agent_message_chunk"; content: AcpContentBlock }
  | { sessionUpdate: "agent_thought_chunk"; content: AcpContentBlock }
  | { sessionUpdate: "available_commands_update" }
  | { sessionUpdate: "config_option_update"; configOptions: AcpConfigOption[] }
  | { sessionUpdate: "current_mode_update"; currentModeId: string }
  | { sessionUpdate: "plan"; entries: AcpPlanEntry[] }
  | { sessionUpdate: "user_message_chunk"; content: AcpContentBlock }
  | (AcpToolCall & { sessionUpdate: "tool_call_update" })
  | (AcpToolCall & { sessionUpdate: "tool_call" });

export type AcpStopReason =
  | "cancelled"
  | "end_turn"
  | "max_tokens"
  | "max_turn_requests"
  | "refusal";

export interface AcpPromptUsage {
  inputTokens?: number;
  outputTokens?: number;
  cachedReadTokens?: number | null;
  totalTokens?: number;
}

export interface AcpPromptResult {
  stopReason: AcpStopReason;
  usage?: AcpPromptUsage | null;
}

export type AcpPermissionKind =
  | "allow_always"
  | "allow_once"
  | "reject_always"
  | "reject_once";

export interface AcpPermissionOption {
  optionId: string;
  name: string;
  kind: AcpPermissionKind;
}

export interface AcpPermissionRequest {
  sessionId: string;
  toolCall: AcpToolCall;
  options: AcpPermissionOption[];
}

export type AcpPermissionOutcome =
  | { outcome: "cancelled" }
  | { outcome: "selected"; optionId: string };

export type AcpMcpServer =
  | {
      name: string;
      command: string;
      args: string[];
      env: { name: string; value: string }[];
    }
  | {
      type: "http";
      name: string;
      url: string;
      headers: { name: string; value: string }[];
    };
