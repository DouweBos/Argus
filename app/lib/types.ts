export interface Workspace {
  /** The branch this workspace was created from (e.g. "main"). */
  base_branch?: null | string;
  branch: string;
  description: string;
  /** Original display name (e.g. "Testing Conductor"). Shown in UI when present. */
  display_name?: null | string;
  id: string;
  kind: "repo_root" | "worktree";
  path: string;
  repo_root: string;
  status: "initializing" | "ready" | { error: string };
}

/** Normalise workspace status to a simple display string. */
export function workspaceStatusLabel(status: Workspace["status"]): string {
  if (typeof status === "string") return status;
  return "error";
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

export interface TerminalConfigEntry {
  dir?: string;
  name?: string;
}

export type WorkspaceEnvStrategy = "hash" | "sequential";

export interface WorkspaceEnvConfig {
  /** Starting integer. Final value is base_value + offset. */
  base_value?: number;
  /** Env var name (e.g. STAGEHAND_PORT, RCT_METRO_PORT). */
  name: string;
  /** Modulus for the hash strategy (default 1000). */
  range?: number;
  /** How to compute the per-workspace offset (default: hash). */
  strategy?: WorkspaceEnvStrategy;
}

export interface DirEntry {
  is_dir: boolean;
  name: string;
  size: number;
}

export interface FileStat {
  is_dir: boolean;
  mtime: number;
  size: number;
}

/** Run button configuration — either a plain command string or object with dir. */
export type RunConfig = { command: string; dir?: string } | string;

export interface StagehandConfig {
  /** Shell command to run via the "Run" button (e.g. `npx expo start`). */
  run?: RunConfig;
  setup?: {
    commands?: string[];
    copy?: string[];
    symlink?: string[];
  };
  terminals?: TerminalConfigEntry[];
  /** Env var set in each workspace's terminals with a unique integer per workspace. */
  workspace_env?: WorkspaceEnvConfig;
}

// ---------------------------------------------------------------------------
// Claude Code stream-json event types
// ---------------------------------------------------------------------------

export type ClaudeStreamEvent =
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
      type: "assistant";
    }
  | { message: { content: ClaudeToolResult[] }; type: "user" }
  | {
      model: string;
      session_id: string;
      slash_commands?: string[];
      subtype: "init";
      tools: Array<{ name: string }>;
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
// Permission request (from PreToolUse hook via IPC event)
// ---------------------------------------------------------------------------

export interface PermissionRequest {
  tool_input: Record<string, unknown>;
  tool_name: string;
  tool_use_id: string;
}
