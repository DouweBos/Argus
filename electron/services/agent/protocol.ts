/**
 * TypeScript types for the Claude Code CLI bidirectional control protocol.
 *
 * When spawned with `--permission-prompt-tool stdio`, the CLI emits
 * `control_request` messages on stdout and expects `control_response`
 * messages on stdin. This module defines the shapes of those messages.
 *
 * Reference: claude-code `src/entrypoints/sdk/controlSchemas.ts`
 */

// ---------------------------------------------------------------------------
// Permission suggestions (sent by CLI with can_use_tool requests)
// ---------------------------------------------------------------------------

export interface PermissionSuggestion {
  /** Suggestion type, e.g. "allow". */
  type: string;
  /** Tool name, e.g. "Edit", "Bash". */
  tool: string;
  /** Optional path prefix or glob for scoped rules. */
  prefix?: string;
}

// ---------------------------------------------------------------------------
// Control request payloads (stdout: CLI → Parent)
// ---------------------------------------------------------------------------

export interface CanUseToolPayload {
  subtype: "can_use_tool";
  tool_name: string;
  input: Record<string, unknown>;
  tool_use_id: string;
  permission_suggestions?: PermissionSuggestion[];
  blocked_path?: string;
  decision_reason?: string;
  title?: string;
  display_name?: string;
  description?: string;
  agent_id?: string;
}

export interface InitializePayload {
  subtype: "initialize";
  hooks?: Record<string, unknown>;
  sdkMcpServers?: string[];
  jsonSchema?: Record<string, unknown>;
  systemPrompt?: string;
  appendSystemPrompt?: string;
  agents?: Record<string, unknown>;
}

export interface InterruptPayload {
  subtype: "interrupt";
}

export interface SetModelPayload {
  subtype: "set_model";
  model?: string;
}

export interface SetPermissionModePayload {
  subtype: "set_permission_mode";
  mode: string;
}

export interface McpStatusPayload {
  subtype: "mcp_status";
}

export interface ElicitationPayload {
  subtype: "elicitation";
  mcp_server_name: string;
  message: string;
  mode?: "form" | "url";
  url?: string;
  elicitation_id?: string;
  requested_schema?: Record<string, unknown>;
}

export interface HookCallbackPayload {
  subtype: "hook_callback";
  callback_id: string;
  input: Record<string, unknown>;
  tool_use_id?: string;
}

export type ControlRequestPayload =
  | CanUseToolPayload
  | InitializePayload
  | InterruptPayload
  | SetModelPayload
  | SetPermissionModePayload
  | McpStatusPayload
  | ElicitationPayload
  | HookCallbackPayload;

// ---------------------------------------------------------------------------
// Top-level control messages (stdout: CLI → Parent)
// ---------------------------------------------------------------------------

export interface ControlRequest {
  type: "control_request";
  request_id: string;
  request: ControlRequestPayload;
}

export interface ControlCancelRequest {
  type: "control_cancel_request";
  request_id: string;
}

// ---------------------------------------------------------------------------
// Control response (stdin: Parent → CLI)
// ---------------------------------------------------------------------------

export interface ControlResponseSuccess {
  subtype: "success";
  request_id: string;
  response?: Record<string, unknown>;
}

export interface ControlResponseError {
  subtype: "error";
  request_id: string;
  error: string;
}

export interface ControlResponse {
  type: "control_response";
  response: ControlResponseSuccess | ControlResponseError;
}

// ---------------------------------------------------------------------------
// Permission decision (the response.response payload for can_use_tool)
// ---------------------------------------------------------------------------

export interface PermissionDecisionAllow {
  behavior: "allow";
  updatedInput?: Record<string, unknown>;
  updatedPermissions?: PermissionSuggestion[];
}

export interface PermissionDecisionDeny {
  behavior: "deny";
  message?: string;
}

export type PermissionDecision =
  | PermissionDecisionAllow
  | PermissionDecisionDeny;

// ---------------------------------------------------------------------------
// Initialize response (returned by CLI after initialize control_request)
// ---------------------------------------------------------------------------

export interface SlashCommandInfo {
  name: string;
  description: string;
  argumentHint: string;
}

export interface ModelInfo {
  value: string;
  displayName: string;
  description: string;
  supportsEffort?: boolean;
  supportedEffortLevels?: string[];
  supportsFastMode?: boolean;
}

export interface AgentInfo {
  name: string;
  description: string;
  model?: string;
}

export interface AccountInfo {
  email?: string;
  organization?: string;
  subscriptionType?: string;
  apiProvider?: string;
}

export interface InitializeResponse {
  commands: SlashCommandInfo[];
  agents: AgentInfo[];
  output_style: string;
  available_output_styles: string[];
  models: ModelInfo[];
  account: AccountInfo;
}
