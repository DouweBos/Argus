export interface Workspace {
  /** The branch this workspace was created from (e.g. "main"). */
  base_branch?: string | null;
  branch: string;
  description: string;
  /** Original display name (e.g. "Testing Conductor"). Shown in UI when present. */
  display_name?: string | null;
  id: string;
  kind: "org_host" | "repo_root" | "worktree";
  /** OrgTask that owns this workspace (if spawned from a cross-repo task). */
  organization_task_id?: string | null;
  path: string;
  repo_root: string;
  status: "deleting" | "initializing" | "ready" | { error: string };
}

/** Normalise workspace status to a simple display string. */
export function workspaceStatusLabel(status: Workspace["status"]): string {
  if (typeof status === "string") {
    return status;
  }

  return "error";
}

export interface BranchList {
  local: string[];
  remote: string[];
}

/** Check if workspace is ready. */
export function isWorkspaceReady(status: Workspace["status"]): boolean {
  return status === "ready";
}

export interface TerminalSession {
  id: string;
  title: string;
  workspace_id: string;
}

export interface AgentStatus {
  agent_id: string;
  /**
   * Prompt sent to an externally-spawned agent (e.g. via the MCP `spawn_agent`
   * tool). Present only on the `agent:started` event — used by the renderer
   * to derive a session title, since the UI never sees the first user
   * message for MCP-spawned agents.
   */
  initial_prompt?: string;
  /** Agent that spawned this one (null for user-initiated agents). */
  parent_agent_id?: string | null;
  /** Claude Code permission mode (e.g. "plan", "default"). Frontend-only field. */
  permission_mode?: string;
  status: "error" | "idle" | "running" | "stopped";
  workspace_id: string;
}

export interface SimulatorDevice {
  booted: boolean;
  name: string;
  runtime: string;
  udid: string;
}

export type DevicePlatform = "android" | "ios" | "web";

export interface DeviceInfo {
  agentId: string | null;
  deviceKey: string;
  name: string;
  online: boolean;
  platform: DevicePlatform;
  repoRoot: string | null;
  reservationKey: string;
  reserved: boolean;
  runtime?: string;
  workspaceId: string | null;
  workspacePath: string | null;
}

export interface ConductorLogEntry {
  args: string;
  command: string;
  deviceKey: string;
  durationMs: number;
  error?: string;
  id: number;
  kind: "cli" | "http";
  ok: boolean;
  output?: string;
  ts: number;
}

export interface AndroidDevice {
  /** AVD name (emulators only — used to boot). Null for physical devices. */
  avdName: string | null;
  name: string;
  online: boolean;
  serial: string;
  type: "emulator" | "physical";
}

/** Sent once when SPS+PPS are parsed from the H.264 stream. */
export interface AndroidVideoConfig {
  codec: string;
  codedHeight: number;
  codedWidth: number;
  description: Uint8Array;
}

/** Sent per H.264 access unit (frame). */
export interface AndroidVideoFrame {
  data: Uint8Array;
  keyFrame: boolean;
  timestamp: number;
}

export interface TerminalConfigEntry {
  dir?: string;
  name?: string;
}

export type WorkspaceEnvStrategy = "hash" | "sequential";

export interface WorkspaceEnvConfig {
  /** Starting integer. Final value is base_value + offset. */
  base_value?: number;
  /** Env var name (e.g. ARGUS_PORT, RCT_METRO_PORT). */
  name: string;
  /** Modulus for the hash strategy (default 1000). */
  range?: number;
  /** How to compute the per-workspace offset (default: hash). */
  strategy?: WorkspaceEnvStrategy;
}

export type DependencySeverity = "optional" | "required";

export interface DependencyStatus {
  hint: string;
  id: string;
  installed: boolean;
  name: string;
  platforms: string[];
  purpose: string;
  resolvedPath?: string;
  severity: DependencySeverity;
}

export interface DependencyReport {
  dependencies: DependencyStatus[];
  missingOptional: number;
  missingRequired: number;
  platform: string;
}

export interface DirEntry {
  is_dir: boolean;
  name: string;
  size: number;
}

export interface MentionDirEntry {
  is_dir: boolean;
  name: string;
}

export interface MentionPathResult {
  entries: MentionDirEntry[];
  resolvedPath: string;
}

export interface FileStat {
  is_dir: boolean;
  mtime: number;
  size: number;
}

/** A single entry in `.argus.json` `run` — a labelled shell command. */
export interface RunCommand {
  command: string;
  cwd?: string;
  restartOnRerun: boolean;
  title: string;
}

/** JSON-facing shape for custom browser device presets in `.argus.json`. */
export interface BrowserPresetConfig {
  height: number;
  id: string;
  label?: string;
  user_agent?: string;
  width: number;
}

export type RuntimePlatform = "android" | "ios" | "web";

export interface ArgusConfig {
  /** Optional prompt appended to the Claude agent's system prompt. */
  agent_prompt?: string;
  /** Custom browser device presets for the web browser panel. */
  browser_presets?: BrowserPresetConfig[];
  /** Default URL to load in the embedded web browser (e.g. "http://localhost:3000"). */
  browser_url?: string;
  /**
   * Runtime platforms this project targets. Agents only pre-allocate iOS
   * simulators / Android emulators / headless Chromium browsers for the
   * platforms listed here. Omitted or empty → no runtimes pre-allocated.
   */
  platforms?: RuntimePlatform[];
  /**
   * Branch names that cannot be merged into directly from the app — the UI
   * shows a "Push & open PR" flow instead. Typical values: `["main"]`.
   */
  protected_branches?: string[];
  /** Ordered list of run commands shown in the app's run menu. */
  run?: RunCommand[];
  /** Whether to save chat history when agents stop. Defaults to true. */
  save_chat_history?: boolean;
  setup?: {
    commands?: string[];
    copy?: string[];
    symlink?: string[];
  };
  terminals?: TerminalConfigEntry[];
  /** Env vars set in each workspace's terminals with a unique integer per workspace. */
  workspace_env?: WorkspaceEnvConfig[];
}

/**
 * Per-developer, per-project preferences. Stored in the user's home directory
 * (not the repo), so every developer keeps their own values.
 */
export interface UserProjectSettings {
  /**
   * Required prefix prepended to newly created branches (e.g. "douwe/"). Empty
   * or undefined disables the prefix.
   */
  branch_prefix?: string;
}

// ---------------------------------------------------------------------------
// Claude Code stream-json event types
// ---------------------------------------------------------------------------

export type ClaudeStreamEvent =
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
      result?: string;
      subtype: "error" | "success";
      total_cost_usd: number;
      type: "result";
      usage: TokenUsage;
    }
  | {
      message: {
        content: ClaudeContentBlock[];
        model: string;
        usage: TokenUsage;
      };
      /** Present when this assistant message is from a sub-agent (Task/Agent tool). */
      parent_tool_use_id?: string | null;
      type: "assistant";
    }
  | {
      message: { content: ClaudeToolResult[] };
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

export type ClaudeContentBlock =
  | {
      id: string;
      input: Record<string, unknown>;
      name: string;
      type: "tool_use";
    }
  | { text: string; type: "text" };

export interface ClaudeToolResult {
  /** May be a plain string or a structured content block from the Claude API. */
  content: unknown;
  is_error?: boolean;
  tool_use_id: string;
  type: "tool_result";
}

export interface TokenUsage {
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
// Capabilities (from initialize control_request response)
// ---------------------------------------------------------------------------

export interface SlashCommand {
  /** Hint for arguments (e.g. "<file>", ""). */
  argumentHint: string;
  /** Description of what the command does. */
  description: string;
  /** Command name without leading slash. */
  name: string;
}

export interface ModelInfo {
  description: string;
  displayName: string;
  supportedEffortLevels?: string[];
  supportsEffort?: boolean;
  supportsFastMode?: boolean;
  value: string;
}

export interface AgentCapabilities {
  agents: { description: string; model?: string; name: string }[];
  commands: SlashCommand[];
  models: ModelInfo[];
}

// ---------------------------------------------------------------------------
// Organizations
// ---------------------------------------------------------------------------

export interface OrganizationMember {
  repo_root: string;
  role: string;
}

export interface Organization {
  accent: string;
  created_at: number;
  description: string;
  id: string;
  members: OrganizationMember[];
  name: string;
  system_prompt: string;
  updated_at: number;
}

// ---------------------------------------------------------------------------
// Organization tasks
// ---------------------------------------------------------------------------

export type OrgTaskStatus = "cancelled" | "completed" | "failed" | "running";

export interface OrgTaskScopeEntry {
  repo_root: string;
  role: string;
}

// ---------------------------------------------------------------------------
// Onboarding
// ---------------------------------------------------------------------------

export const ONBOARDING_STEPS = [
  "welcome",
  "permissions",
  "preflight",
  "claude_auth",
  "defaults",
  "project",
  "argus_config",
  "first_workspace",
  "first_agent",
  "completion",
] as const;

export type OnboardingStep = (typeof ONBOARDING_STEPS)[number];

export interface OnboardingDefaults {
  model: string;
  permissionMode: string;
  worktreeRoot: string;
}

export interface OnboardingStateData {
  completed: boolean;
  completedAt: number | null;
  lastStep: OnboardingStep;
  skipped: string[];
  version: number;
}

export interface OnboardingConfigFile {
  defaults: OnboardingDefaults;
  onboarding: OnboardingStateData;
  recentProjects: string[];
}

export type PrereqId =
  | "android_avd"
  | "android_sdk"
  | "claude_auth"
  | "claude_cli"
  | "git_cli"
  | "git_identity"
  | "ios_runtimes"
  | "native_bridge"
  | "playwright"
  | "xcode";

export type PrereqStatus = "fail" | "pass" | "running" | "skipped" | "warn";

export interface PrereqResult {
  detail?: string;
  fixable?: boolean;
  id: PrereqId;
  message?: string;
  mobileOnly?: boolean;
  status: PrereqStatus;
}

export type DetectedSignalKind =
  | "framework"
  | "monorepo"
  | "native"
  | "platform"
  | "project"
  | "tooling";

export interface DetectedSignal {
  detail?: string;
  kind: DetectedSignalKind;
  label: string;
}

export interface ArgusConfigSuggestion {
  config: Record<string, unknown>;
  inferredFrom: string[];
  signals: DetectedSignal[];
}

export interface ExampleProject {
  description: string;
  name: string;
  platform: "android" | "ios" | "web";
  repo: string;
  slug: string;
}

export interface OrgTask {
  created_at: number;
  host_agent_id: string | null;
  host_workspace_id: string | null;
  id: string;
  organization_id: string;
  prompt: string;
  scope: OrgTaskScopeEntry[];
  status: OrgTaskStatus;
  title: string;
  updated_at: number;
}
