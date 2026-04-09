/**
 * Data types for workspace management.
 *
 * A `Workspace` maps 1-to-1 with a git worktree living in the sibling
 * `<repo>-stagehand-worktrees/<branch>/` directory.
 */

/** Whether this workspace is backed by a git worktree or the repo root itself. */
export type WorkspaceKind = "worktree" | "repo_root";

/**
 * Lifecycle state of a workspace.
 *
 * Matches the Rust enum serialised with `rename_all = "snake_case"` and
 * the frontend `WorkspaceStatus` type in `src/lib/types.ts`.
 */
export type WorkspaceStatus = "initializing" | "ready" | { error: string };

/** A single workspace backed by a git worktree or the repo root. */
export interface Workspace {
  /** Stable UUID used as the key in `appState.workspaces`. */
  id: string;
  /** Whether this is a worktree or repo-root workspace. */
  kind: WorkspaceKind;
  /** The feature branch checked out in this worktree. */
  branch: string;
  /** Original display name as entered by the user. Shown in the UI when present. */
  display_name?: string | null;
  /** Optional human-readable description for the UI. */
  description: string;
  /** Absolute path to the worktree root on disk. */
  path: string;
  /** Absolute path to the repository root this workspace belongs to. */
  repo_root: string;
  /** Current lifecycle status. */
  status: WorkspaceStatus;
  /**
   * Sequential index assigned at creation time (for `WorkspaceEnvStrategy.sequential`).
   * Only set for non-RepoRoot workspaces.
   */
  env_index?: number | null;
  /** The branch this workspace was created from (e.g. "main"). */
  base_branch?: string | null;
}

/** A terminal to auto-open when loading a workspace. */
export interface TerminalConfig {
  /** Human-readable label shown on the tab. */
  name: string;
  /** Relative directory (from the workspace root) to start the shell in. */
  dir: string;
}

/** Strategy for computing a unique env-var value per workspace. */
export type WorkspaceEnvStrategy = "hash" | "sequential";

/** Config for an env var set in each workspace's terminals with a unique integer. */
export interface WorkspaceEnvConfig {
  /** Env var name (e.g. `STAGEHAND_PORT`, `RCT_METRO_PORT`). */
  name: string;
  /** Starting integer. Final value is `base_value + offset`. */
  base_value: number;
  /** Modulus for the hash strategy (default 1000). */
  range: number;
  /** How to compute the per-workspace offset. */
  strategy: WorkspaceEnvStrategy;
}

/** A related project that agents can create worktrees in and work on. */
export interface RelatedProject {
  /** Relative path from this project's root to the related project's root. */
  path: string;
  /** Human-readable description of what this project is. */
  description: string;
}

/** Configuration for the "Run" button. */
export interface RunConfig {
  /** Shell command to execute (e.g. `npx expo start`). */
  command: string;
  /** Optional relative directory (from the workspace root) to run the command in. */
  dir?: string;
}

/** The `setup` block inside `.stagehand.json`. */
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

/** Parsed representation of `.stagehand.json` found at the repo root. */
export interface StagehandConfig {
  /** Setup instructions run once when a new workspace is created. */
  setup: SetupConfig;
  /** Terminals to auto-open when a workspace is selected. */
  terminals: TerminalConfig[];
  /** Env vars with a unique integer per workspace (e.g. for port allocation). */
  workspace_env: WorkspaceEnvConfig[];
  /** Optional run config for the "Run" button. */
  run?: RunConfig | null;
  /** Optional prompt appended to the Claude agent's system prompt. */
  agent_prompt?: string | null;
  /** Related projects that agents can create worktrees in and work on. */
  related_projects?: RelatedProject[];
}

/** Default/empty `SetupConfig`. */
export function defaultSetupConfig(): SetupConfig {
  return { copy: [], symlink: [], commands: [] };
}

/** Default/empty `StagehandConfig`. */
export function defaultStagehandConfig(): StagehandConfig {
  return {
    setup: defaultSetupConfig(),
    terminals: [],
    workspace_env: [],
    run: null,
    agent_prompt: null,
    related_projects: [],
  };
}
