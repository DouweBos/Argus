/**
 * Data types for session management.
 *
 * A `Session` maps 1-to-1 with a git worktree living in the sibling
 * `<repo>-argus-worktrees/<branch>/` directory.
 */

import type { AutonomyLevel } from "../automation/models";

/**
 * What a session is backed by: a git worktree, the repo root itself, or — for
 * an automation run — a neutral directory that is not a checkout at all.
 */
export type SessionKind = "automation_host" | "project_root" | "worktree";

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
  /**
   * Transient terminal id for the setup pipeline's PTY, included on the
   * response from `create_session` so the renderer can attach a Setup tab
   * synchronously — avoiding a race against the `session:setup_terminal`
   * event. Not persisted; absent on subsequent session listings.
   */
  setup_terminal_id?: string | null;
  /**
   * LLM runner this session is bound to (e.g. `"claude-code"`). Stamped at
   * `create_session` time by `resolveRunnerForSession`; switchable via
   * `set_session_runner` until the first message is sent, after which the
   * transcript pins it. Every agent spawned in this session inherits it and
   * cannot override it at spawn time. Legacy sessions persisted before this
   * field existed default to {@link DEFAULT_RUNNER_ID} via
   * {@link sessionRunnerId} on read.
   */
  runner_id?: string | null;
  /**
   * Default model id (runner-specific shape) for agents spawned in this
   * session. `null` lets the cascade fall through to the project default,
   * app default, then runner default. Editable post-create via the
   * Runner+Model picker.
   */
  model?: string | null;
  /**
   * Claude account this session's agents and terminals authenticate as. `null`
   * follows the app-wide active account. Lets two sessions run in parallel on
   * different accounts.
   */
  claude_account_id?: string | null;
}

/**
 * Fallback runner id used when reading a Session that pre-dates the
 * `runner_id` field.
 */
export const DEFAULT_RUNNER_ID = "claude-code";

/**
 * Read the session's runner id, defaulting legacy sessions to
 * {@link DEFAULT_RUNNER_ID}. Use this everywhere you need a runner id —
 * never read `session.runner_id` directly.
 */
export function sessionRunnerId(session: Pick<Session, "runner_id">): string {
  return session.runner_id ?? DEFAULT_RUNNER_ID;
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

/**
 * A single entry in the simulator/device "Link" dropdown — either a leaf
 * link fired via `conductor open-link <url>`, or a folder grouping nested
 * entries underneath a label. Folders may themselves contain folders so
 * teams can organise long lists hierarchically (e.g. "Onboarding" →
 * "First-run" → "Step 2").
 */
export interface SimulatorDeeplinkConfig {
  /** Display name shown in the dropdown (e.g. "Settings", "Profile"). */
  label: string;
  /**
   * URL or custom-scheme deep link. Required for leaf entries; must be
   * absent on folder entries (which use `children` instead).
   */
  url?: string;
  /**
   * Nested entries when this is a folder. Mutually exclusive with `url`.
   * An empty array is treated as no children (folder hidden).
   */
  children?: SimulatorDeeplinkConfig[];
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

/**
 * A single entry in `setup.copy` / `setup.symlink`. Either a bare path/glob
 * string or a structured object that pairs the path with `exclude` patterns
 * pruned from the copy/symlink expansion.
 *
 * `exclude` patterns are forwarded to `rsync --exclude=<pattern>` for copy
 * entries (so subdirectories are pruned mid-tree, not just at expansion
 * time) and applied as `fast-glob` ignore patterns for symlink entries
 * (which only matters for glob-shaped paths — symlinking a literal
 * directory is a single link, so excludes have no effect there).
 */
export type SetupCopyEntry = string | { path: string; exclude?: string[] };

/** The `setup` block inside `.argus.json`. */
export interface SetupConfig {
  /**
   * Directories/files to copy from the main repo into the new worktree.
   * Supports glob patterns (e.g. "*.env", "packages/*\/node_modules") and,
   * when expressed as an object, per-entry `exclude` patterns (e.g.
   * `{ path: ".claude", exclude: ["projects/**\/worktrees/**"] }`).
   */
  copy: SetupCopyEntry[];
  /**
   * Files to symlink from the main repo into the new worktree.
   * Supports glob patterns (e.g. "*.env", "**\/.env.local") and the same
   * object form as `copy` — although `exclude` is only meaningful for
   * glob-shaped entries.
   */
  symlink: SetupCopyEntry[];
  /**
   * Shell commands to execute inside the new worktree after copy/symlink.
   * Each entry is passed verbatim to `sh -c`.
   */
  commands: string[];
}

/** Read the path string from a `SetupCopyEntry` regardless of its shape. */
export function setupEntryPath(entry: SetupCopyEntry): string {
  return typeof entry === "string" ? entry : entry.path;
}

/** Read the exclude list from a `SetupCopyEntry` (empty for bare strings). */
export function setupEntryExcludes(entry: SetupCopyEntry): string[] {
  return typeof entry === "string" ? [] : (entry.exclude ?? []);
}

/** Runtime platform a session targets. Drives which device-specific sections
 * appear in the agent system prompt. */
export type RuntimePlatform = "android" | "ios" | "tvos" | "web";

/**
 * Project-level default LLM runner + model. Either field may be absent —
 * the resolver cascade (agent override → session → project → app default)
 * fills in whichever the user hasn't pinned. An unknown `runner` id is
 * tolerated at parse time (logged as a warning) so the resolver can fall
 * back gracefully if a runner is removed/renamed in a future release.
 */
export interface LlmConfig {
  /** Runner id, e.g. "claude-code". When null/absent, falls back to the
   * app-level default runner. */
  runner?: string | null;
  /** Default model id for this project, in whatever shape the runner
   * accepts. When null/absent, the runner picks its own default. */
  model?: string | null;
}

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
   * Preferred default source branch for new sessions (e.g. `"staging"`,
   * `"develop"`). When set, the Create-Session dialog preselects this
   * branch instead of falling back to `main`/`master`. Branch must exist
   * locally to be picked; otherwise the fallback chain runs.
   */
  default_base_branch?: string | null;
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
  /**
   * Glob-driven release-note patterns surfaced on the session home screen.
   * An alternative to `@changesets/cli` for projects that keep release
   * notes as plain text / structured files (e.g. one `.txt` per ticket).
   *
   * Each entry is either a bare glob string or a `{ glob, format, labels }`
   * object that also tells Argus how to parse the file and which fields to
   * surface as Badges next to the filename.
   */
  release_note_patterns: ReleaseNotePatternConfig[];
  /**
   * Deep links surfaced as a dropdown on the runtime toolbar's "Link" button.
   * Each entry fires `conductor open-link <url> --device <id>` against the
   * currently connected simulator/emulator.
   */
  simulator_deeplinks: SimulatorDeeplinkConfig[];
  /**
   * How often (in minutes) Argus should automatically run `git fetch --prune`
   * in the background for this project. Set to 0 or omit to disable
   * auto-fetch entirely.
   */
  auto_fetch_minutes?: number | null;
  /**
   * Project-level default LLM runner + model. Used as the cascade step
   * between agent/session overrides and the app-level default. The runner
   * is bound at session creation; the model is re-resolved per agent
   * spawn. Either field may be absent.
   */
  llm?: LlmConfig | null;
  /**
   * Tools disabled for everyone working on this project. Effective enable =
   * userToggle AND !projectDisabled. A project can mask tools off (e.g. a
   * server-only repo turning off device-* tools) but cannot force a tool
   * on if the user has it off. List the tool id strings; unknown ids are
   * ignored. Set/parsed in `electron/services/session/setup.ts`.
   */
  tools?: { disabled?: string[] } | null;
  /**
   * How far Argus automations may go in this repo. The ceiling caps the app
   * default and the automation's own setting — a repo can always ask for less
   * autonomy, never more. Parsed in `session/setup.ts`.
   */
  automations?: ProjectAutomationConfig | null;
}

/** The `automations` block of `.argus.json`. Every field is optional. */
export interface ProjectAutomationConfig {
  /** Highest rung any automation may reach in this repo. */
  autonomy_ceiling?: AutonomyLevel | null;
  /** Automation ids or template ids this repo opts out of entirely. */
  disabled?: string[];
  /** Globs no automation-started branch may touch. Added to the automation's own list. */
  path_denylist?: string[];
}

/** Tone for label badges, mirrored from Peacock's `Badge.tone`. */
export type ReleaseNoteLabelTone = "accent" | "neutral" | "success" | "warning";

/**
 * Format used to parse a release-note file before extracting labels.
 *
 * - `regex` — line-anchored regex per label.
 * - `json` / `yaml` / `xml` — parse, then resolve dotted paths into the tree.
 * - `changesets` — `@changesets/cli` format. YAML frontmatter declaring
 *   `"<package>": <bump>` entries becomes the badge labels (one per
 *   package), and the body after the closing `---` becomes the entry's
 *   visible content. Any user-provided `labels` are ignored — they're
 *   derived from the frontmatter instead.
 */
export type ReleaseNoteFormat =
  | "changesets"
  | "json"
  | "regex"
  | "xml"
  | "yaml";

/** A single label extracted from a release-note file and shown as a Badge. */
export interface ReleaseNoteLabelConfig {
  /** Display name shown on the badge (e.g. "type", "platform"). */
  name: string;
  /**
   * For `format: "regex"` — a regex with one capture group, applied with
   * `m`/`i` flags. The capture is the badge value. Example: `^Type:\s*(.+)$`.
   *
   * For `format: "json" | "yaml" | "xml"` — a dotted path into the parsed
   * object. Array indices use numeric segments (e.g. `meta.tags.0`).
   */
  selector: string;
  /** Optional Peacock badge tone. Defaults to "neutral". */
  tone?: ReleaseNoteLabelTone | null;
}

/** Structured form of a single `release_note_patterns` entry. */
export interface ReleaseNotePatternConfig {
  /** Glob pattern (repo-root relative). Uses git's `:(glob)` pathspec semantics. */
  glob: string;
  /**
   * How to parse the file before extracting labels. Defaults to `"regex"`,
   * which is also the only format that does not depend on the file being
   * valid JSON/YAML/XML — labels are extracted line-by-line with regex.
   */
  format: ReleaseNoteFormat;
  /** Labels to extract and show as Badges. Empty = filename + status only. */
  labels: ReleaseNoteLabelConfig[];
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
    default_base_branch: null,
    single_runtime: false,
    mcp_servers: null,
    min_argus_version: null,
    release_note_patterns: [],
    simulator_deeplinks: [],
    auto_fetch_minutes: null,
    llm: null,
    tools: null,
    automations: null,
  };
}
