import type { ShareErrorPayload } from "./shareError";
import type { ReportBlock } from "@argus/remote-protocol";

export interface Session {
  /** The branch this session was created from (e.g. "main"). */
  base_branch?: string | null;
  branch: string;
  /**
   * Claude account this session's agents and terminals authenticate as.
   * `null`/absent follows the app-wide active account.
   */
  claude_account_id?: string | null;
  description: string;
  /** Original display name (e.g. "Testing Conductor"). Shown in UI when present. */
  display_name?: string | null;
  id: string;
  kind: "automation_host" | "project_root" | "worktree";
  /**
   * Default model id (runner-specific) for agents spawned in this session.
   * `null` lets the cascade fall through to project / app / runner defaults.
   */
  model?: string | null;
  path: string;
  repo_root: string;
  /**
   * LLM runner this session is bound to (e.g. `"claude-code"`). Stamped at
   * create-time and immutable for the session's lifetime. Legacy sessions
   * persisted before this field existed default to `"claude-code"` on read.
   */
  runner_id?: string | null;
  /** Transient terminal id for the setup PTY; only present on create_session. */
  setup_terminal_id?: string | null;
  status: "deleting" | "initializing" | "ready" | { error: string };
}

/** Normalise session status to a simple display string. */
export function sessionStatusLabel(status: Session["status"]): string {
  if (typeof status === "string") {
    return status;
  }

  return "error";
}

export interface BranchList {
  local: string[];
  /**
   * All origin-tracking refs as `origin/<name>`, including those whose name
   * also exists locally. Use this when you need to distinguish a local branch
   * from its origin counterpart (e.g. picking a base branch).
   */
  originRefs: string[];
  remote: string[];
}

export type ReleaseNoteLabelTone = "accent" | "neutral" | "success" | "warning";

export interface ReleaseNoteLabel {
  name: string;
  tone?: ReleaseNoteLabelTone;
  value: string;
}

// ---------------------------------------------------------------------------
// Git status (shared with `electron/services/session/gitStatus.ts`)
// ---------------------------------------------------------------------------

export interface GitInProgress {
  head: string;
  kind: "bisect" | "cherry-pick" | "merge" | "rebase";
  onto?: string;
}

export interface GitStatus {
  ahead: number;
  behind: number;
  branch: string;
  conflictCount: number;
  detached: boolean;
  dirtyCount: number;
  inProgress: GitInProgress | null;
  /** Unix ms timestamp of `.git/FETCH_HEAD` mtime, or null if never fetched. */
  lastFetchAt: number | null;
  stashCount: number;
  upstream: string | null;
}

/** Channel name for the FS-watcher push event (debounced). */
export const GIT_STATUS_CHANGED_EVENT = "git_status_changed";

export interface GitStatusChangedPayload {
  sessionId: string;
}

export interface ChangesetEntry {
  /** File name within `.changeset/`, e.g. `silly-cats-dance.md`. */
  filename: string;
  /** Packages + bump types declared in the frontmatter. */
  packages: { bump: string; name: string }[];
  /** Body of the changeset (release note text), trimmed. */
  summary: string;
}

export interface ReleaseNoteEntry {
  /** Full text content of the file as it lives on this branch (trimmed). */
  content: string;
  /** Path relative to the repo root, e.g. `apps/foo/release-notes/next/PLAY-27.txt`. */
  filename: string;
  /** Format used to parse this entry — surfaces format-specific UI affordances. */
  format: ReleaseNoteFormat;
  /** Labels extracted via the matching pattern's `labels` config. */
  labels: ReleaseNoteLabel[];
  /** "added" if the file is new on this branch, "modified" if it existed at the merge-base. */
  status: "added" | "modified";
}

export type ReleaseNoteFormat =
  | "changesets"
  | "json"
  | "regex"
  | "xml"
  | "yaml";

export interface ReleaseNoteLabelConfig {
  name: string;
  selector: string;
  tone?: ReleaseNoteLabelTone | null;
}

export interface ReleaseNotePatternConfig {
  format: ReleaseNoteFormat;
  glob: string;
  labels: ReleaseNoteLabelConfig[];
}

export interface SessionReleaseNotesResult {
  entries: ReleaseNoteEntry[];
  /** Patterns the project configured in `.argus.json#release_note_patterns`. */
  patterns: ReleaseNotePatternConfig[];
  /** True when the project declares any patterns. False = fall back to changesets. */
  usesReleaseNotes: boolean;
}

/** Check if session is ready. */
export function isSessionReady(status: Session["status"]): boolean {
  return status === "ready";
}

export interface TerminalSession {
  id: string;
  session_id: string;
  title: string;
}

/** An image attached to a queued message, as the backend stores it. */
export interface QueuedImage {
  data: string;
  media_type: string;
}

/**
 * A message waiting for an agent's current turn to end. Owned by the backend
 * (`electron/services/agent/messageQueue.ts`) so the queue survives restarts
 * and is shared with the web and phone clients.
 */
export interface QueuedMessage {
  /** Who queued it, when a huddle guest rather than the local user did. */
  author?: string;
  /** What the clients show, when it differs from `text` (e.g. a preamble). */
  display_text?: string;
  id: string;
  images?: QueuedImage[];
  queued_at: number;
  text: string;
}

export interface AgentStatus {
  agent_id: string;
  /**
   * Initialize-response capabilities returned inline on `start_agent` so the
   * renderer has them before the async `agent:capabilities` event would
   * otherwise race with listener setup.
   */
  capabilities?: AgentCapabilities | null;
  /**
   * Unix ms timestamp when the agent session was created on the backend.
   * Optional because optimistic renderer-side entries and synthetic device-nav
   * placeholders don't know the authoritative value until the backend reports.
   */
  created_at?: number;
  /**
   * Reasoning-effort level (e.g. "low", "medium", "high", "xhigh", "max").
   * `null` / undefined means the model's default. Frontend-only field; the
   * runner's `apply_flag_settings` control message is the source of truth.
   */
  effort?: string | null;
  /**
   * Prompt sent to an externally-spawned agent (e.g. via the MCP `spawn_agent`
   * tool). Present only on the `agent:started` event — used by the renderer
   * to derive a session title, since the UI never sees the first user
   * message for MCP-spawned agents.
   */
  initial_prompt?: string;
  /**
   * Model id this agent was spawned with (variant suffixes like `[1m]`
   * preserved), or null/undefined if the CLI default was used. Carried
   * across restore-at-turn and restartAgent so the next spawn re-passes
   * `--model` and the 1M-context variant doesn't silently revert to 200K.
   */
  model?: string | null;
  /** Agent that spawned this one (null for user-initiated agents). */
  parent_agent_id?: string | null;
  /** Claude Code permission mode (e.g. "plan", "default"). Frontend-only field. */
  permission_mode?: string;
  session_id: string;
  status: "error" | "idle" | "requires_action" | "running" | "stopped";
}

export interface SimulatorDevice {
  booted: boolean;
  name: string;
  runtime: string;
  udid: string;
}

export type DevicePlatform = "android" | "ios" | "video" | "web";

export interface DeviceInfo {
  agentId: string | null;
  deviceKey: string;
  /** Machine the device is attached to. Unset means this Mac. */
  hostId?: string;
  name: string;
  online: boolean;
  platform: DevicePlatform;
  repoRoot: string | null;
  reservationKey: string;
  reserved: boolean;
  runtime?: string;
  sessionId: string | null;
  sessionPath: string | null;
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

/** Status of the runtime conductor-version override (Settings → Tools). */
export interface ConductorStatus {
  /** Version resolved for invocations right now (override when ready, else bundled). */
  activeVersion: string | null;
  /** Version baked into this app build. */
  bundledVersion: string | null;
  error: string | null;
  /** User-pinned version, or null when using the bundled default. */
  overrideVersion: string | null;
  state: "error" | "idle" | "installing" | "ready";
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
  /** How to compute the per-session offset (default: hash). */
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
  /** Titles of other run commands that must already be running first. */
  requires?: string[];
  restartOnRerun: boolean;
  title: string;
}

/** A related project that agents can spawn worktrees in. */
export interface RelatedProject {
  /** Human-readable description shown to spawned agents. */
  description: string;
  /** Relative path from this repo's root to the related project's root. */
  path: string;
}

/**
 * A deep link entry surfaced by the runtime toolbar's "Link" dropdown.
 * Either a leaf link fired via `conductor open-link <url>` or a folder
 * grouping nested entries — folders may themselves contain folders.
 */
export interface SimulatorDeeplinkConfig {
  /** Nested entries when this is a folder. Mutually exclusive with `url`. */
  children?: SimulatorDeeplinkConfig[];
  /** Display name shown in the dropdown. */
  label: string;
  /** URL or custom-scheme deep link (leaf entries only). */
  url?: string;
}

/** JSON-facing shape for custom browser device presets in `.argus.json`. */
export interface BrowserPresetConfig {
  height: number;
  id: string;
  label?: string;
  user_agent?: string;
  width: number;
}

export type RuntimePlatform = "android" | "ios" | "tvos" | "web";

/**
 * A registered LLM runner surfaced to the renderer via `list_runners`.
 * Mirrors the small subset of `LlmRunner` the UI needs.
 */
export interface RegisteredRunner {
  /** Official runner a custom runner derives from; null for built-ins. */
  baseRunnerId?: string | null;
  /** Capability flags (e.g. `supportsMcp`, `supportsSetModel`). */
  capabilities: {
    supportsInterrupt: boolean;
    supportsMcp: boolean;
    supportsSetEffort: boolean;
    supportsSetModel: boolean;
    supportsSetPermissionMode: boolean;
    supportsTranscriptFork: boolean;
  };
  /** Model applied when nothing else pins one. */
  defaultModel?: string | null;
  /** Human-readable label, e.g. "Claude Code". */
  displayName: string;
  /** Stable id, e.g. `"claude-code"`. */
  id: string;
  /** True for user-configured runners derived from an official one. */
  isCustom?: boolean;
  /**
   * Models the runner declares up front. Empty for runners that only learn
   * their model list from the live handshake (Claude Code).
   */
  models?: CustomRunnerModel[];
}

/** A model offered by a custom runner. */
export interface CustomRunnerModel {
  description?: string;
  displayName: string;
  /** Model id passed to the CLI, e.g. `callstack/Apex`. */
  value: string;
}

/**
 * A user-configured runner derived from an official one. Persisted in
 * `~/.argus/custom-runners.json`; mirrors `CustomRunner` on the main side.
 */
export interface CustomRunnerConfig {
  /** Official runner it delegates to, e.g. `"claude-code"`. */
  baseRunnerId: string;
  /** Model used when nothing else pins one. */
  defaultModel: string | null;
  displayName: string;
  /** Env overrides applied to every spawn. Empty value unsets a variable. */
  env: Record<string, string>;
  /** `custom:<slug>`. Omitted when creating a new runner. */
  id?: string;
  /** Models offered in the picker. */
  models: { description?: string; displayName: string; id: string }[];
}

/** Pre-filled starting point offered in the "Add runner" menu. */
export interface CustomRunnerPreset {
  description: string;
  draft: Omit<CustomRunnerConfig, "id">;
  key: string;
  label: string;
  /** Env var holding the API key/token the user must supply. */
  secretEnvKey: string;
}

/**
 * Project-level default LLM runner + model. Either field may be absent —
 * the resolver cascade fills in whichever isn't pinned here. Mirrors the
 * `LlmConfig` shape in `electron/services/session/models.ts`.
 */
export interface LlmConfig {
  /** Default model id for this project. */
  model?: string | null;
  /** Runner id, e.g. "claude-code". */
  runner?: string | null;
}

/**
 * A `setup.copy` / `setup.symlink` entry: either a bare path/glob string or
 * `{ path, exclude? }` to prune subdirectories from the copy/symlink
 * expansion. Mirrors `SetupCopyEntry` in
 * `electron/services/session/models.ts`.
 */
export type SetupCopyEntry = string | { exclude?: string[]; path: string };

/** The `automations` block of `.argus.json`. */
export interface ProjectAutomationConfig {
  /** Highest rung any automation may reach here. Never raises the app default. */
  autonomy_ceiling?: AutonomyLevel;
  /** Automation ids or template ids this repo opts out of entirely. */
  disabled?: string[];
  /** Globs no automation-started branch may touch. Added to the automation's own list. */
  path_denylist?: string[];
}

export interface ArgusConfig {
  /** Optional prompt appended to the Claude agent's system prompt. */
  agent_prompt?: string;
  /**
   * How often (in minutes) Argus should automatically run `git fetch --prune`
   * in the background. Set to 0 or omit to disable.
   */
  auto_fetch_minutes?: number;
  /** How far Argus automations may go in this repo. Caps the app default. */
  automations?: ProjectAutomationConfig;
  /** Custom browser device presets for the web browser panel. */
  browser_presets?: BrowserPresetConfig[];
  /** Default URL to load in the embedded web browser (e.g. "http://localhost:3000"). */
  browser_url?: string;
  /**
   * Preferred default source branch for new sessions (e.g. `"staging"`,
   * `"develop"`). When set and the branch exists locally, the
   * Create-Session dialog preselects it. Falls back to a
   * staging/develop/dev/main/master probe otherwise.
   */
  default_base_branch?: string | null;
  /**
   * Project-level default LLM runner + model. Used as the cascade step
   * between agent/session overrides and the app-level default.
   */
  llm?: LlmConfig | null;
  /**
   * Project-level MCP servers, merged into every spawned agent. Map of
   * server name to its `.mcp.json`-style config. Use `.mcp.json` for the
   * Claude Code standard discovery path; this field keeps entries
   * co-located with the rest of `.argus.json`.
   */
  mcp_servers?: Record<string, Record<string, unknown>>;
  /**
   * Minimum Argus app version required for this project. Semver string
   * (e.g. "0.10.0"). Surfaces a warning on the project home screen when
   * the app version is lower.
   */
  min_argus_version?: string | null;
  /**
   * Runtime platforms this project targets. Used to narrow the runtime
   * sections injected into the agent system prompt; omitted or empty →
   * iOS, Android, and Web are all described. Does not gate device
   * allocation — simulators, emulators, and browsers are acquired
   * lazily when agents run `conductor` commands.
   */
  platforms?: RuntimePlatform[];
  /**
   * Branch names that cannot be merged into directly from the app — the UI
   * shows a "Push & open PR" flow instead. Typical values: `["main"]`.
   */
  protected_branches?: string[];
  /**
   * Filename of the preferred pull-request template — used by the
   * "Push & open PR" flow when the repo has multiple templates in
   * `.github/PULL_REQUEST_TEMPLATE/`. Without this, Argus uses the first
   * template alphabetically.
   */
  pull_request_template?: string;
  /**
   * Other repos that agents in this project may spawn worktrees in.
   * Surfaced via the `list_projects` MCP tool.
   */
  related_projects?: RelatedProject[];
  /**
   * Glob-driven release-note patterns surfaced on the session home screen
   * as an alternative to `@changesets/cli`. Each entry can be either a
   * bare glob string or a `{ glob, format, labels }` object that also
   * tells Argus how to parse the file (regex / json / yaml / xml) and
   * which fields to render as Badges next to the filename.
   */
  release_note_patterns?: ReleaseNotePatternConfig[];
  /** Ordered list of run commands shown in the app's run menu. */
  run?: RunCommand[];
  /** Whether to save chat history when agents stop. Defaults to true. */
  save_chat_history?: boolean;
  setup?: {
    commands?: string[];
    copy?: SetupCopyEntry[];
    symlink?: SetupCopyEntry[];
  };
  /**
   * Deep links surfaced as a dropdown on the runtime toolbar's "Link"
   * button. Each entry fires `conductor open-link <url>` against the
   * currently connected simulator/emulator.
   */
  simulator_deeplinks?: SimulatorDeeplinkConfig[];
  /**
   * When true, only one runtime may be active across all sessions of this
   * project. The run button prompts before starting a second runtime.
   */
  single_runtime?: boolean;
  terminals?: TerminalConfigEntry[];
  /**
   * Tools disabled for everyone working on this project. Strings — see
   * `app/tools/types.ts` for valid `ToolId`s. Unknown ids are ignored.
   */
  tools?: { disabled?: string[] } | null;
  /** Env vars set in each session's terminals with a unique integer per session. */
  workspace_env?: WorkspaceEnvConfig[];
}

/** A single MCP server Argus inherits from outside its own settings. */
export interface InheritedMcpServer {
  config: Record<string, unknown>;
  name: string;
  /** e.g. "plugin:plex-tools", "~/.claude.json", ".mcp.json". */
  source: string;
}

/** Result of a connectivity probe against an MCP server. */
export interface McpTool {
  description?: string;
  name: string;
}

export interface McpTestResult {
  /** Truncated response body for diagnosis. */
  bodySnippet?: string;
  error?: string;
  /** Short, human-friendly next-step suggestion. */
  hint?: string;
  latencyMs?: number;
  ok: boolean;
  protocolVersion?: string;
  /** OAuth protected-resource metadata URL parsed from `WWW-Authenticate`. */
  resourceMetadataUrl?: string;
  serverInfo?: { name?: string; version?: string };
  /** HTTP status code, when the failure came from the transport layer. */
  status?: number;
  /** Tools advertised by the server (best-effort, HTTP only). */
  tools?: McpTool[];
  transport: "http" | "stdio" | "unknown";
  /** Raw `WWW-Authenticate` header from a 401/403, if any. */
  wwwAuthenticate?: string;
}

/** OAuth status for a single MCP server (returned by `mcp_oauth_status`). */
export interface McpOAuthStatus {
  expiresAt: number | null;
  hasRefreshToken: boolean;
  resource: string;
  scope: string | null;
}

/** Machine-local app settings persisted in `~/.argus/app-settings.json`. */
export interface AppSettings {
  /**
   * Extra shell commands a read-only automation may run, beyond the built-in
   * reads. A bare command or a prefix. Machine-local: a project cannot widen
   * it, or a repo could authorise itself.
   */
  automation_allowed_commands?: string[];
  /** Extra tools a read-only automation may call, by exact name. */
  automation_allowed_tools?: string[];
  /** Spend automations may reach in a day, in USD. 0 or unset = no budget. */
  automation_daily_budget_usd?: number;
  /**
   * Master switch for the automation scheduler. Defaults to true; manual runs
   * work regardless.
   */
  automations_enabled?: boolean;
  /**
   * How far an automation may go when it does not set its own level. Ships as
   * `propose`; a project can cap it lower, never higher.
   */
  default_autonomy?: AutonomyLevel;
  /** App-level default LLM picked in Settings, mirrored for the main process. */
  default_llm?: { model?: string | null; runner?: string | null };
  /** Screen Argus opens on: the project picker, or the inbox. Defaults to home. */
  launch_route?: "home" | "inbox";
  /** Auto-started automation sessions allowed at once. Defaults to 3. */
  max_concurrent_automation_sessions?: number;
  /** User-defined MCP servers merged into every spawned agent. */
  mcp_servers?: Record<string, Record<string, unknown>>;
  /**
   * Auto-updater feed channel. `latest` is stable; `alpha` and `beta` are
   * pre-release feeds for internal testing. Defaults to `latest`.
   */
  updater_channel?: "alpha" | "beta" | "latest";
}

/**
 * Per-developer, per-project preferences. Stored in the user's home directory
 * (not the repo), so every developer keeps their own values.
 */
export interface UserProjectSettings {
  /**
   * Branch names hidden from the main sidebar Branches list and surfaced
   * under "Archived Branches". Pure UI filter — git is untouched.
   */
  archived_branches?: string[];
  /**
   * Required prefix prepended to newly created branches (e.g. "douwe/"). Empty
   * or undefined disables the prefix.
   */
  branch_prefix?: string;
  /**
   * Branch names pinned for quick access. Shown in the "Pinned" sidebar
   * section and also inline in the main Branches list.
   */
  pinned_branches?: string[];
  /**
   * When true, the git-lfs "not installed" and "tracked files" banners are
   * hidden for this project regardless of auto-detection. Personal preference;
   * never written into the repo.
   */
  suppress_lfs_warning?: boolean;
}

// ---------------------------------------------------------------------------
// Automations
// ---------------------------------------------------------------------------

/** What causes an automation to fire. */
export type AutomationTrigger =
  | {
      /** Fire once after a missed window instead of backfilling every slot. */
      catch_up: boolean;
      /** 5-field cron: `min hour dom mon dow`. */
      cron: string;
      kind: "schedule";
      /** IANA zone the cron fields are read in. */
      timezone: string;
    }
  | { kind: "manual" };

export type AutomationTriggerKind = AutomationTrigger["kind"];

/** The autonomy ladder. Each rung contains the one before it. */
export type AutonomyLevel =
  | "auto_merge" // draft + push + open a PR + merge when CI is green
  | "draft" // create the worktree, implement, commit — then stop
  | "pr" // draft + push + open a draft PR
  | "propose"; // write a proposal into the inbox; touch nothing

/** The limits a run is held to, enforced in the host, not in the prompt. */
export interface AutomationGuardrails {
  /** 0..1. A proposal below this never auto-starts. */
  confidence_threshold: number;
  /** Auto-started sessions this automation may have in flight at once. */
  max_concurrent_sessions: number;
  /** Ceiling on a single run's spend. */
  max_cost_usd_per_run: number;
  /** A branch touching more files than this cannot be pushed. */
  max_files_changed: number;
  /** Globs no automation-started branch may touch. */
  path_denylist: string[];
  /** Gates `auto_merge`: CI must be green first. */
  require_clean_ci: boolean;
}

/** A persisted "when X, do Y" object. */
export interface Automation {
  /** How far this automation may go. Null inherits the app-wide default. */
  autonomy: AutonomyLevel | null;
  created_at: number;
  description: string;
  enabled: boolean;
  /** The limits it is held to. */
  guardrails: AutomationGuardrails;
  id: string;
  last_run_at: number | null;
  /** Model for the run's agent; null inherits the app default. */
  model: string | null;
  name: string;
  /** Next scheduled fire, epoch ms. Null when there is no clock. */
  next_run_at: number | null;
  /** The instructions handed to the run's agent. Markdown. */
  playbook: string;
  /** Projects the run may read. */
  scope: { repo_roots: string[] };
  /** Signal sources feeding the run, by id. Empty = no signals. */
  source_ids: string[];
  /** Built-in template this was seeded from. */
  template_id: string | null;
  trigger: AutomationTrigger;
  updated_at: number;
}

export type AutomationRunStatus =
  | "cancelled"
  | "failed"
  | "queued"
  | "running"
  | "skipped"
  | "succeeded";

/**
 * The one-off spec behind an ad-hoc run. No automation is persisted for it —
 * the host rebuilds a synthetic one from this when it resolves the run's
 * policy, and the spec goes when the run is swept.
 */
export interface AutomationScratchSpec {
  guardrails: AutomationGuardrails;
  model: string | null;
  name: string;
  playbook: string;
  scope: { repo_roots: string[] };
  source_ids: string[];
}

/** Fields accepted when starting an ad-hoc run. */
export interface StartScratchRunInput {
  guardrails?: Partial<AutomationGuardrails>;
  model?: string | null;
  name?: string;
  playbook: string;
  repo_roots?: string[];
  source_ids?: string[];
}

/** One firing of an automation. */
/** One thing a read-only automation was refused, and what would allow it. */
export interface GateLogEntry {
  automation_id: string;
  automation_name: string;
  command: string | null;
  count: number;
  first_seen_at: number;
  id: string;
  kind: "command" | "tool";
  last_seen_at: number;
  run_id: string;
  /** Add this to the matching allowlist to permit it. */
  suggested_entry: string;
  tool_name: string;
}

export interface AutomationRun {
  /** For an ad-hoc run, the synthetic id of its `scratch` spec. */
  automation_id: string;
  cost_usd: number | null;
  /** Failure message, or — for a `skipped` run — why it did not fire. */
  error: string | null;
  finished_at: number | null;
  host_agent_id: string | null;
  /** The `automation_host` session the run's agent lives in. */
  host_session_id: string | null;
  id: string;
  /** Structured blocks from `emit_report`, preferred over the markdown. */
  report_blocks?: ReportBlock[] | null;
  /** The agent's final message. Plain markdown. */
  report_markdown: string | null;
  /**
   * False until the run has been acknowledged — its report looked at, a newer
   * report superseding it, or the run dismissed from the inbox.
   */
  report_read: boolean;
  /** Set only on an ad-hoc run: the one-off spec no automation backs. */
  scratch: AutomationScratchSpec | null;
  started_at: number;
  status: AutomationRunStatus;
  /** Human-readable cause: `"manual"`, `"schedule 07:30"`, `"catch-up …"`. */
  trigger_reason: string;
}

/** How an automation's proposals have actually turned out. */
export interface AutomationCalibration {
  abandoned: number;
  /**
   * Accepted + auto-started over everything decided. Null while nothing has
   * been decided.
   */
  acceptance_rate: number | null;
  accepted: number;
  auto_started: number;
  automation_id: string;
  dismissals: { reason: string; title: string }[];
  dismissed: number;
  merged: number;
  pending: number;
  reverted: number;
  /** Proposals considered — the newest twenty. */
  sample: number;
}

/** A signal source a run can be fed from, as the editor lists them. */
export interface SignalSourceInfo {
  /** False when the source has nothing to answer with — no `gh`, no MCP. */
  available: boolean;
  id: string;
  label: string;
  /** `native` = Argus fetches it; `agent` = the run's agent fetches it. */
  mode: "agent" | "native";
}

/** Fields accepted when creating an automation. */
export interface CreateAutomationInput {
  autonomy?: AutonomyLevel | null;
  description?: string;
  enabled?: boolean;
  guardrails?: Partial<AutomationGuardrails>;
  model?: string | null;
  name: string;
  playbook: string;
  scope?: { repo_roots: string[] };
  source_ids?: string[];
  template_id?: string | null;
  trigger: AutomationTrigger;
}

export type UpdateAutomationInput = Partial<
  Omit<Automation, "created_at" | "id" | "updated_at">
>;

/** A Claude-drafted automation, plus what Argus had to correct about it. */
export interface AutomationDraft {
  /** Ready to save — always disabled, never above the default autonomy. */
  input: CreateAutomationInput;
  /** Repairs and drops, shown above the draft so nothing is silent. */
  notes: string[];
}

// ---------------------------------------------------------------------------
// Proposals
// ---------------------------------------------------------------------------

export type ProposalStatus =
  | "accepted"
  | "auto_started"
  | "dismissed"
  | "pending";

export type ProposalAction =
  | "ignore"
  | "needs_info"
  | "review"
  | "start_session";

/** The work item a proposal came from, when it has one. */
export interface ProposalSourceRef {
  /** Id within the source, e.g. `plexinc/app#412`. */
  external_id: string;
  /** Signal source that produced it, e.g. `github`. */
  source_id: string;
  url: string;
}

/**
 * What the proposal's primary button does. `start_session` is the only kind
 * that spins up a worktree — everything else sends the user somewhere.
 */
export type ProposalCtaKind = "open_url" | "start_session";

/** The one action a proposal is asking for, as rendered in the inbox. */
export interface ProposalCta {
  kind: ProposalCtaKind;
  /** Button text, written by the run: "Start", "Open PR #6478". */
  label: string;
  /** Where `open_url` goes. Null for `start_session`. */
  url: string | null;
}

/** One thing an automation run wants you to do. */
export interface Proposal {
  automation_id: string;
  /** 0..1, self-reported by the run's agent. */
  confidence: number;
  created_at: number;
  /** Primary action. Null when the only thing to do is read it and dismiss. */
  cta: ProposalCta | null;
  /** Why it was dismissed, verbatim. */
  dismissed_reason: string | null;
  id: string;
  /** Why the run ranked it where it did. */
  rationale: string;
  /** What the run thinks should happen. */
  recommended_action: ProposalAction;
  /** Project the work would happen in. Null when it maps to no local repo. */
  repo_root: string | null;
  run_id: string;
  /** Session doing the work, once the proposal was started. */
  session_id: string | null;
  source_ref: ProposalSourceRef | null;
  status: ProposalStatus;
  /** What the work is, in markdown. */
  summary: string;
  title: string;
}

/** What accepting a proposal produced. */
export interface AcceptProposalResult {
  agent_id: string;
  proposal: Proposal;
  session_id: string;
}

// ---------------------------------------------------------------------------
// Claude Code stream-json event types
// ---------------------------------------------------------------------------

export type LlmStreamEvent =
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
  | { text: string; type: "text" };

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
// Claude account
// ---------------------------------------------------------------------------

/** Current Claude CLI account, mirrors `claude auth status --json`. */
export interface ClaudeAuthStatus {
  apiProvider?: string;
  authMethod?: string;
  email?: string;
  loggedIn: boolean;
  orgId?: string;
  orgName?: string;
  subscriptionType?: string;
}

/**
 * A Claude account Argus keeps signed in. Each one gets its own CLI config dir,
 * so identity and credentials belong to that account alone.
 */
export interface ClaudeAccount {
  account_type: "claudeai" | "console";
  auth_method?: string;
  created_at: number;
  email?: string;
  id: string;
  /** User-editable display name; falls back to the email. */
  label?: string;
  /** A run failed to authenticate — the credentials need renewing. */
  needs_reauth?: boolean;
  org_id?: string;
  org_name?: string;
  subscription_type?: string;
}

export interface ClaudeAccountsState {
  accounts: ClaudeAccount[];
  activeId: string;
}

// Onboarding
// ---------------------------------------------------------------------------

export const ONBOARDING_STEPS = ["welcome", "telemetry"] as const;

export type OnboardingStep = (typeof ONBOARDING_STEPS)[number];

export interface OnboardingStateData {
  completed: boolean;
  completedAt: number | null;
  lastStep: OnboardingStep;
  skipped: string[];
  version: number;
}

export interface OnboardingConfigFile {
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

export interface ProjectEntry {
  description: string;
  path: string;
  registered: boolean;
  source: string;
}

export interface ExampleProject {
  description: string;
  name: string;
  platform: "android" | "ios" | "web";
  repo: string;
  slug: string;
}

export type PullRequestReason =
  | "author"
  | "commenter"
  | "mentioned"
  | "reviewer"
  | "team";

export interface InterestingPullRequest {
  author: string | null;
  authorAvatarUrl: string | null;
  baseRefName: string;
  createdAt: string;
  headRefName: string;
  isDraft: boolean;
  number: number;
  reasons: PullRequestReason[];
  repoNameWithOwner: string;
  /** Absolute path of the Argus-open project this PR's repo maps to. */
  repoRoot: string;
  repoUrl: string;
  /** `APPROVED` | `CHANGES_REQUESTED` | `REVIEW_REQUIRED` | null. */
  reviewDecision: string | null;
  title: string;
  updatedAt: string;
  url: string;
}

export interface PullRequestFile {
  additions: number;
  changeType: string;
  deletions: number;
  path: string;
}

export interface PullRequestCommit {
  abbreviatedOid: string;
  author: string | null;
  authorAvatarUrl: string | null;
  committedDate: string;
  message: string;
  oid: string;
  statusRollup: string | null;
  url: string;
}

export interface PullRequestCheck {
  conclusion: string | null;
  description: string | null;
  detailsUrl: string | null;
  name: string;
  status: string | null;
}

export interface InlineReviewComment {
  body: string;
  /** GitHub's pre-rendered HTML — autolinks, emoji, task lists, etc. */
  bodyHtml: string;
  createdAt: string;
  id: string;
  url: string;
}

export interface PullRequestComment {
  author: string | null;
  authorAvatarUrl: string | null;
  body: string;
  /** GitHub's pre-rendered HTML — autolinks, emoji, task lists, etc. */
  bodyHtml: string;
  createdAt: string;
  id: string;
  /** Inline review comments attached to a `kind === "review"` entry. */
  inlineComments?: InlineReviewComment[];
  kind: "issue" | "review";
  reviewState?: string;
  url: string;
}

export interface PullRequestDetail {
  additions: number;
  author: string | null;
  authorAvatarUrl: string | null;
  baseRefName: string;
  body: string;
  /** GitHub's pre-rendered HTML — autolinks, emoji, task lists, etc. */
  bodyHtml: string;
  changedFiles: number;
  checks: PullRequestCheck[];
  comments: PullRequestComment[];
  commitList: PullRequestCommit[];
  commits: number;
  createdAt: string;
  deletions: number;
  files: PullRequestFile[];
  headRefName: string;
  isDraft: boolean;
  labels: string[];
  mergeable: string;
  merged: boolean;
  number: number;
  repoNameWithOwner: string;
  repoUrl: string;
  state: string;
  title: string;
  updatedAt: string;
  url: string;
}

// ---------------------------------------------------------------------------
// Remote access (phone/web control)
// ---------------------------------------------------------------------------

/**
 * One snapshot of everything the backend is running. Remote mode rebuilds from
 * this on connect; local mode never drops, so it never needs it.
 */
export interface HostSnapshot {
  agents: AgentStatus[];
  projects: ProjectEntry[];
  sessions: Session[];
}

/** A directory on the host, for the remote project picker. */
export interface HostDirectoryEntry {
  /** True when the directory looks like a git repo — a candidate project root. */
  is_repo: boolean;
  name: string;
  path: string;
}

export interface HostDirectoryListing {
  entries: HostDirectoryEntry[];
  /** The host's home directory, for a "start over" affordance. */
  home: string;
  /** Absolute parent path, or null at the filesystem root. */
  parent: string | null;
  path: string;
}

/** Where a client-side file landed after being uploaded to the host. */
export interface UploadedAttachment {
  name: string;
  /** Absolute path on the host. */
  path: string;
  size: number;
}

export interface RemoteDevicePush {
  environment?: "production" | "sandbox";
  /** Web Push only — the subscription's encryption keys. */
  keys?: { auth: string; p256dh: string };
  service: "apns" | "fcm" | "webpush";
  /** Native device token, or the Web Push endpoint URL. */
  token: string;
  updated_at: number;
}

export interface RemoteDevice {
  capabilities: string[];
  created_at: number;
  dev_static_pub: string;
  device_id: string;
  label: string;
  last_seen: number | null;
  /** Set once the phone registered a native push token. */
  push?: RemoteDevicePush | null;
}

/** Push settings — presence flags only, never the keys. */
export interface RemotePushConfig {
  enabled: boolean;
  /** Where phones register their relay auth key. */
  relayUrl: string;
  /** VAPID contact claim sent to the browser's push service. */
  vapidSubject: string;
  /** True once the browser signing key has been minted. */
  webPushConfigured: boolean;
}

export interface RemotePushConfigPatch {
  enabled?: boolean;
  /** `mailto:`/`https:` contact the browser's push service can reach you at. */
  vapidSubject?: string;
}

export interface RemotePushTestResult {
  delivered: boolean;
  reason?: string;
}

export type RemoteTunnelMode = "quick" | "token";
export type RemoteTunnelProvider = "cloudflare" | "tailscale";
export type RemoteEndpointKind = RemoteTunnelProvider | "lan";
export type RemoteTunnelStatus = "error" | "running" | "starting" | "stopped";

export interface RemoteTunnelState {
  error: string | null;
  publicUrl: string | null;
  /** Whether that URL was last seen to reach the gateway; null until probed. */
  reachable: boolean | null;
  status: RemoteTunnelStatus;
}

/** One address a phone can reach this desktop on. Lower priority wins. */
export interface RemoteEndpoint {
  kind: RemoteEndpointKind;
  priority: number;
  url: string;
}

export interface RemoteStatus {
  cloudflareEnabled: boolean;
  connectedDeviceIds: string[];
  devices: RemoteDevice[];
  enabled: boolean;
  endpoints: RemoteEndpoint[];
  hasTunnelToken: boolean;
  lanUrl: string | null;
  lanWebEnabled: boolean;
  /** Mirror notifications to devices even while the desktop window is focused. */
  notifyWhenFocused: boolean;
  publicUrl: string | null;
  tailscaleEnabled: boolean;
  tunnelMode: RemoteTunnelMode;
  tunnels: Record<RemoteTunnelProvider, RemoteTunnelState>;
}

export type TailscaleStepId = "cli" | "daemon" | "funnel" | "login";
export type TailscaleStepState = "blocked" | "fail" | "ok";
export type TailscaleFixKind =
  | "install-cli"
  | "open-url"
  | "sign-in"
  | "start-daemon";

export interface TailscaleStep {
  detail: string | null;
  fix: TailscaleFixKind | null;
  fixLabel: string | null;
  id: TailscaleStepId;
  message: string;
  state: TailscaleStepState;
  title: string;
  url: string | null;
}

export interface TailscaleDiagnosis {
  bin: string | null;
  dnsName: string | null;
  ready: boolean;
  steps: TailscaleStep[];
}

export interface TailscaleFixResult {
  diagnosis: TailscaleDiagnosis;
  error: string | null;
  openUrl: string | null;
}

export interface RemotePairingStart {
  pairingCode: string;
  qrPayload: string;
}

/**
 * Huddle rooms — a temporary link that lets a guest talk to one agent and
 * drive one device. The shapes are the host's, re-exported here so components
 * import them like every other backend type.
 */
export type {
  HuddleGuest,
  HuddleGuestState,
  HuddleRoom,
} from "@argus/remote-protocol";

/** Whether sharing can mint a link, and what's in the way when it can't. */
export interface ShareReadiness {
  blocker?: ShareErrorPayload;
  ready: boolean;
}

/** Named hinge poses for a foldable simulator (iPhone Duo). */
export type FoldPose = "book" | "closed" | "open" | "partial";

/** Orientations an iOS simulator can be rotated to. */
export type DeviceOrientation =
  | "landscapeLeft"
  | "landscapeRight"
  | "portrait"
  | "portraitUpsideDown";

export interface FoldState {
  /** Hinge angle in degrees: 0 is shut, 180 is flat open. */
  angle: number;
  pose: FoldPose;
}

/** The panel being captured, and how its contents are rotated. */
export interface DisplayInfo {
  /** Framebuffer height in pixels, before rotation. */
  height: number;
  /** Clockwise degrees the view must rotate the stream by to sit upright. */
  rotation: 0 | 90 | 180 | 270;
  /** CoreSimulator screen ID — changes when a fold lights the other panel. */
  screenID: number;
  /** Framebuffer width in pixels, before rotation. */
  width: number;
}

/** How a simulator is currently being held — drives how the view presents it. */
export interface SimulatorDeviceState {
  /** Null while nothing is being captured. */
  display: DisplayInfo | null;
  /** Null on devices with no hinge. */
  fold: FoldState | null;
  orientation: DeviceOrientation;
  udid: string;
}
