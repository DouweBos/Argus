/**
 * Data types for session management.
 *
 * A `Session` maps 1-to-1 with a git worktree living in the sibling
 * `<repo>-argus-worktrees/<branch>/` directory.
 */

/** Whether this session is backed by a git worktree, the repo root itself,
 * or a neutral directory hosting a cross-repo org task agent. */
export type SessionKind = "org_host" | "project_root" | "worktree";

/**
 * Lifecycle state of a session.
 *
 * Matches the frontend `SessionStatus` type in `src/lib/types.ts`.
 */
export type SessionStatus =
  | "deleting"
  | "initializing"
  | "ready"
  | { error: string };

/** A single session backed by a git worktree or the repo root. */
export interface Session {
  /** Stable UUID used as the key in `appState.sessions`. */
  id: string;
  /** Whether this is a worktree or repo-root session. */
  kind: SessionKind;
  /** The feature branch checked out in this worktree. */
  branch: string;
  /** Original display name as entered by the user. Shown in the UI when present. */
  display_name?: string | null;
  /** Optional human-readable description for the UI. */
  description: string;
  /** Absolute path to the worktree root on disk. */
  path: string;
  /** Absolute path to the repository root this session belongs to. */
  repo_root: string;
  /** Current lifecycle status. */
  status: SessionStatus;
  /**
   * Sequential index assigned at creation time (for `WorkspaceEnvStrategy.sequential`).
   * Only set for non-RepoRoot sessions.
   */
  env_index?: number | null;
  /** The branch this session was created from (e.g. "main"). */
  base_branch?: string | null;
  /** OrgTask that owns this session (if spawned from a cross-repo task). */
  organization_task_id?: string | null;
  /**
   * Transient terminal id for the setup pipeline's PTY, included on the
   * response from `create_session` so the renderer can attach a Setup tab
   * synchronously — avoiding a race against the `session:setup_terminal`
   * event. Not persisted; absent on subsequent session listings.
   */
  setup_terminal_id?: string | null;
}

/** A terminal to auto-open when loading a session. */
export interface TerminalConfig {
  /** Human-readable label shown on the tab. */
  name: string;
  /** Relative directory (from the session root) to start the shell in. */
  dir: string;
}

/** Strategy for computing a unique env-var value per session. */
export type WorkspaceEnvStrategy = "hash" | "sequential";

/** Config for an env var set in each session's terminals with a unique integer. */
export interface WorkspaceEnvConfig {
  /** Env var name (e.g. `ARGUS_PORT`, `RCT_METRO_PORT`). */
  name: string;
  /** Starting integer. Final value is `base_value + offset`. */
  base_value: number;
  /** Modulus for the hash strategy (default 1000). */
  range: number;
  /** How to compute the per-session offset. */
  strategy: WorkspaceEnvStrategy;
}

/** JSON-facing shape for custom browser device presets in `.argus.json`. */
export interface BrowserPresetConfig {
  /** Viewport height in CSS pixels. */
  height: number;
  /** Unique preset identifier (e.g. "iphone-15-pro"). */
  id: string;
  /** Display name shown in the preset picker. Defaults to `id`. */
  label?: string;
  /** Custom user-agent string. Defaults to a desktop Chrome UA. */
  user_agent?: string;
  /** Viewport width in CSS pixels. */
  width: number;
}

/** A related project that agents can create worktrees in and work on. */
export interface RelatedProject {
  /** Relative path from this project's root to the related project's root. */
  path: string;
  /** Human-readable description of what this project is. */
  description: string;
}

/** A single entry in the `.argus.json` `run` array. */
export interface RunCommand {
  /** User-visible label for the command (also used as its identifier). */
  title: string;
  /** Shell command to execute (e.g. `npx expo start`). */
  command: string;
  /**
   * Optional relative directory (from the session root) to run the command
   * in. Defaults to the session root.
   */
  cwd?: string;
  /**
   * If true, running the command again kills any existing session with the
   * same title first. If false, re-running while a session is already alive
   * is a no-op.
   */
  restartOnRerun: boolean;
  /**
   * Titles of other run commands that must already be running in the same
   * session before this one can start. Useful when a frontend run command
   * needs the backend's run command to be alive first. Trying to start while
   * any prerequisite is missing throws a clear error.
   */
  requires?: string[];
}

/** The `setup` block inside `.argus.json`. */
export interface SetupConfig {
  /**
   * Directories/files to copy from the main repo into the new worktree.
   * Supports glob patterns (e.g. "*.env", "packages/*\/node_modules").
   */
  copy: string[];
  /**
   * Files to symlink from the main repo into the new worktree.
   * Supports glob patterns (e.g. "*.env", "**\/.env.local").
   */
  symlink: string[];
  /**
   * Shell commands to execute inside the new worktree after copy/symlink.
   * Each entry is passed verbatim to `sh -c`.
   */
  commands: string[];
}

/** Runtime platform a session targets. Drives which device-specific sections
 * appear in the agent system prompt. */
export type RuntimePlatform = "android" | "ios" | "tvos" | "web";

/** Parsed representation of `.argus.json` found at the repo root. */
export interface ArgusConfig {
  /**
   * Minimum Argus app version required to work with this project. Format is
   * a semver string (e.g. "0.10.0"). When set, the project home screen
   * surfaces a warning banner if the user's running app version is lower.
   */
  min_argus_version?: string | null;
  /** Setup instructions run once when a new session is created. */
  setup: SetupConfig;
  /** Terminals to auto-open when a session is selected. */
  terminals: TerminalConfig[];
  /** Env vars with a unique integer per session (e.g. for port allocation). */
  workspace_env: WorkspaceEnvConfig[];
  /** Ordered list of run commands shown in the app's run menu. */
  run: RunCommand[];
  /** Optional prompt appended to the Claude agent's system prompt. */
  agent_prompt?: string | null;
  /** Related projects that agents can create worktrees in and work on. */
  related_projects?: RelatedProject[];
  /** Default URL to load in the embedded web browser (e.g. "http://localhost:3000"). */
  browser_url?: string | null;
  /** Custom browser device presets for the web browser panel. */
  browser_presets: BrowserPresetConfig[];
  /** Whether to save chat history when agents stop. Defaults to true. */
  save_chat_history?: boolean | null;
  /**
   * Runtime platforms this project targets (e.g. `["ios", "web"]`).
   * When set, the agent system prompt only describes these runtimes instead
   * of the full iOS + Android + tvOS + Web set. If omitted, iOS, Android,
   * and Web are described (backward compatible — tvOS is opt-in).
   */
  platforms?: RuntimePlatform[] | null;
  /**
   * Branches that must be updated through a pull request instead of a direct
   * merge (e.g. `["main", "master"]`). Workspaces whose base branch is
   * protected surface a "Push & open PR" flow instead of "Merge".
   */
  protected_branches: string[];
  /**
   * Filename of the preferred pull-request template — used by the
   * "Push & open PR" flow when the repo has multiple templates in
   * `.github/PULL_REQUEST_TEMPLATE/` (where GitHub otherwise requires an
   * explicit `?template=` query parameter). Matches the filename as it
   * lives on disk, e.g. `"feature.md"`.
   */
  pull_request_template?: string | null;
  /**
   * When true, the project can only have one runtime (run command) active at
   * a time across all its sessions. Pressing Run while another session in the
   * same repo is already running prompts the user to stop the other runtime
   * or cancel.
   */
  single_runtime?: boolean | null;
  /**
   * Project-level MCP servers, merged into every agent spawned for this
   * project. Shape matches Claude Code's `.mcp.json` `mcpServers` map. Use
   * `.mcp.json` for the standard discovery path; this field is for teams who
   * want the entries co-located with the rest of `.argus.json`.
   */
  mcp_servers?: Record<string, Record<string, unknown>> | null;
}

/** Default/empty `SetupConfig`. */
export function defaultSetupConfig(): SetupConfig {
  return { copy: [], symlink: [], commands: [] };
}

/** Default/empty `ArgusConfig`. */
export function defaultArgusConfig(): ArgusConfig {
  return {
    setup: defaultSetupConfig(),
    terminals: [],
    workspace_env: [],
    run: [],
    agent_prompt: null,
    related_projects: [],
    browser_url: null,
    browser_presets: [],
    save_chat_history: true,
    platforms: null,
    protected_branches: [],
    single_runtime: false,
    mcp_servers: null,
    min_argus_version: null,
  };
}
