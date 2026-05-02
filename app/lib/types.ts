export interface Session {
  /** The branch this session was created from (e.g. "main"). */
  base_branch?: string | null;
  branch: string;
  description: string;
  /** Original display name (e.g. "Testing Conductor"). Shown in UI when present. */
  display_name?: string | null;
  id: string;
  kind: "org_host" | "project_root" | "worktree";
  /** OrgTask that owns this session (if spawned from a cross-repo task). */
  organization_task_id?: string | null;
  path: string;
  repo_root: string;
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

export interface ArgusConfig {
  /** Optional prompt appended to the Claude agent's system prompt. */
  agent_prompt?: string;
  /**
   * How often (in minutes) Argus should automatically run `git fetch --prune`
   * in the background. Set to 0 or omit to disable.
   */
  auto_fetch_minutes?: number;
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
    copy?: string[];
    symlink?: string[];
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
  /** Env vars set in each session's terminals with a unique integer per session. */
  workspace_env?: WorkspaceEnvConfig[];
}

/** A single MCP server Argus inherits from outside its own settings. */
export interface InheritedMcpServer {
  config: Record<string, unknown>;
  name: string;
  /** e.g. "plugin:team-tools", "~/.claude.json", ".mcp.json". */
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
  /** User-defined MCP servers merged into every spawned agent. */
  mcp_servers?: Record<string, Record<string, unknown>>;
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
  "launcher",
  "telemetry",
  "completion",
] as const;

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

export interface OrgTask {
  created_at: number;
  /** Human-readable reason a task is in a failed state (e.g. initialize failed). */
  error?: string | null;
  host_agent_id: string | null;
  host_session_id: string | null;
  id: string;
  organization_id: string;
  prompt: string;
  scope: OrgTaskScopeEntry[];
  status: OrgTaskStatus;
  title: string;
  updated_at: number;
}
