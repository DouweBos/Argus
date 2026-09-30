import type { ShareErrorPayload } from "./shareError";
import type { ReportBlock, Session } from "@argus/remote-protocol";

export type {
  DirEntry,
  FileStat,
  HostDirectoryEntry,
  HostDirectoryListing,
  MentionDirEntry,
  MentionPathResult,
  UploadedAttachment,
} from "@argus/remote-protocol";

export type { Session } from "@argus/remote-protocol";

/** Normalise session status to a simple display string. */
export function sessionStatusLabel(status: Session["status"]): string {
  if (typeof status === "string") {
    return status;
  }

  return "error";
}

export type {
  BranchList,
  ReleaseNoteLabelTone,
  ReleaseNoteLabel,
} from "@argus/remote-protocol";

// ---------------------------------------------------------------------------
// Git status (shared with `electron/services/session/gitStatus.ts`)
// ---------------------------------------------------------------------------

export type { GitInProgress, GitStatus } from "@argus/remote-protocol";

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

export type {
  ReleaseNoteEntry,
  ReleaseNoteFormat,
  ReleaseNoteLabelConfig,
  ReleaseNotePatternConfig,
  SessionReleaseNotesResult,
} from "@argus/remote-protocol";

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
  /**
   * Runner this agent is bound to. Inherited from the session at spawn, then
   * switchable per agent until its first prompt.
   */
  runner_id?: string;
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

export type {
  ArgusTerminalConfig as TerminalConfigEntry,
  WorkspaceEnvStrategy,
  WorkspaceEnvConfig,
} from "@argus/remote-protocol";

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

export type {
  ArgusRunCommand as RunCommand,
  RelatedProject,
  SimulatorDeeplinkConfig,
  BrowserPresetConfig,
  RuntimePlatform,
} from "@argus/remote-protocol";

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

export type {
  ArgusLlmConfig as LlmConfig,
  SetupCopyEntry,
  ProjectAutomationConfig,
  ArgusConfig,
} from "@argus/remote-protocol";

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
   * Base directory worktrees opened by automations are created in. Absent
   * falls through to `worktrees_base_dir`.
   */
  automation_worktrees_base_dir?: string;
  /**
   * Master switch for the automation scheduler. Defaults to true; manual runs
   * work regardless.
   */
  automations_enabled?: boolean;
  /**
   * App-wide cap on how far any automation may go. Unset or null means no
   * cap — the automation's own level stands. A project can cap it lower,
   * never higher.
   */
  default_autonomy?: AutonomyLevel | null;
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
  /**
   * Base directory new worktrees are created in, for every project that does
   * not set its own. Absent means `<argusHome>/worktrees`.
   */
  worktrees_base_dir?: string;
}

export type { UserProjectSettings } from "@argus/remote-protocol";

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
  /** Wall-clock ceiling on a single run. A run past this is abandoned. */
  max_run_minutes: number;
  /** Globs no automation-started branch may touch. */
  path_denylist: string[];
  /** Gates `auto_merge`: CI must be green first. */
  require_clean_ci: boolean;
  /** Rerun on the next signed-in Claude account when a plan limit is hit. */
  retry_other_accounts: boolean;
}

/** A persisted "when X, do Y" object. */
export interface Automation {
  /** How far this automation may go. Null inherits the app-wide default. */
  autonomy: AutonomyLevel | null;
  created_at: number;
  description: string;
  enabled: boolean;
  /** The user's additions, appended after the playbook on every run. */
  extra_instructions: string;
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
  /** Runner for the run's agent; null inherits the app default. */
  runner: string | null;
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

export type AutomationMemoryType =
  | "feedback"
  | "project"
  | "reference"
  | "user";

/** One file in an automation's memory, carried from run to run. */
export interface AutomationMemory {
  body: string;
  description: string;
  name: string;
  type: AutomationMemoryType;
  updated_at: number;
}

export interface SaveAutomationMemoryInput {
  body: string;
  description: string;
  name: string;
  /** Set when an edit renamed the memory. */
  previous_name?: string | null;
  type: AutomationMemoryType;
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

/** A note the user left on a run's report, and what it was allowed to do. */
export interface AutomationRunFeedback {
  /** The run could withdraw or supersede proposals while answering this. */
  allow_clearing: boolean;
  created_at: number;
  id: string;
  /** The user's words, verbatim. */
  note: string;
}

export interface AutomationRun {
  /** For an ad-hoc run, the synthetic id of its `scratch` spec. */
  automation_id: string;
  cost_usd: number | null;
  /** Failure message, or — for a `skipped` run — why it did not fire. */
  error: string | null;
  /** What the user pushed back on after reading the report, oldest first. */
  feedback?: AutomationRunFeedback[];
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
   * Accepted + auto-started + resolved over everything decided. Null while
   * nothing has been decided.
   */
  acceptance_rate: number | null;
  accepted: number;
  auto_started: number;
  automation_id: string;
  dismissals: { reason: string; title: string }[];
  dismissed: number;
  merged: number;
  pending: number;
  /** Marked done by you — you did what they asked, outside Argus. */
  resolved: number;
  reverted: number;
  /** Proposals considered — the newest twenty. */
  sample: number;
  /** Replaced by a later run rather than decided on. */
  superseded: number;
  /** Cleared by a later run because the signal behind them went away. */
  withdrawn: number;
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
  extra_instructions?: string;
  guardrails?: Partial<AutomationGuardrails>;
  model?: string | null;
  name: string;
  playbook: string;
  runner?: string | null;
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
  | "pending"
  /** You did what it asked, outside Argus — agreement, not rejection. */
  | "resolved"
  /** Replaced by a later run of the same automation. */
  | "superseded"
  /** Taken out of the inbox by a later run: the signal behind it went away. */
  | "withdrawn";

export type ProposalAction =
  | "ignore"
  | "needs_info"
  | "review"
  | "start_session";

/** The work item a proposal came from, when it has one. */
export interface ProposalSourceRef {
  /** Id within the source, e.g. `acme/app#412`. */
  external_id: string;
  /** Signal source that produced it, e.g. `github`. */
  source_id: string;
  url: string;
}

/**
 * What the proposal's primary button does. `start_session` spins up a
 * worktree, `open_url` sends the user somewhere, and the two `delete_` kinds
 * carry out a cleanup — destructive, so always confirmed first.
 */
export type ProposalCtaKind =
  | "delete_branch"
  | "delete_session"
  | "open_url"
  | "start_session";

/** The one action a proposal is asking for, as rendered in the inbox. */
export interface ProposalCta {
  /** Branch a `delete_branch` clears, in the proposal's own project. */
  branch: string | null;
  /** `git branch -D` rather than `-d`. */
  force: boolean;
  kind: ProposalCtaKind;
  /** Button text, written by the run: "Start", "Open PR #6478". */
  label: string;
  /** Session a `delete_session` retires. Its branch is left alone. */
  session_id: string | null;
  /** Where `open_url` goes. Null for every other kind. */
  url: string | null;
}

/** One thing an automation run wants you to do. */
/** Where a start is while it builds the session, in order. */
export type ProposalStartStage =
  | "creating_worktree"
  | "setting_up"
  | "starting_agent";

export interface Proposal {
  /** What the user added when they started it — part of the agent's brief. */
  accepted_note: string | null;
  /** The agent working it, once it is running. */
  agent_id: string | null;
  automation_id: string;
  /** When a later run cleared it. Null while nobody has. */
  cleared_at: number | null;
  /** Why a later run cleared it, in the run's words. */
  cleared_reason: string | null;
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
  /** When you marked it done. Null while nobody has. */
  resolved_at: number | null;
  /** What you said when you marked it done, verbatim. */
  resolved_note: string | null;
  /** What the user wants changed before this is worth starting, verbatim. */
  revision_request: string | null;
  /** When the revision was asked for. Null while nobody has asked. */
  revision_requested_at: number | null;
  run_id: string;
  /** Session doing the work, once the proposal was started. */
  session_id: string | null;
  source_ref: ProposalSourceRef | null;
  /** Why the last start failed, readable. Cleared when a start begins. */
  start_error: string | null;
  /** Non-null only while a start is in flight. */
  start_stage: ProposalStartStage | null;
  status: ProposalStatus;
  /** What the work is, in markdown. */
  summary: string;
  /** The proposal that replaced this one, when it was superseded. */
  superseded_by: string | null;
  title: string;
}

/** What accepting a proposal produced. */
export interface AcceptProposalResult {
  agent_id: string;
  proposal: Proposal;
  session_id: string;
}

/** What asking for a better proposal produced. */
export interface RequestRevisionResult {
  proposal: Proposal;
  /** False when no run started — the note waits for the next scheduled one. */
  run_started: boolean;
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
  /** A run hit the plan's usage limit — credentials are fine, the quota isn't. */
  rate_limited?: boolean;
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

/** Why the Claude auth check is unhappy; mirrors `@argus/host`. */
export type ClaudeAuthReason =
  | "all_rate_limited"
  | "no_accounts"
  | "selected_rate_limited"
  | "selected_signed_out"
  | "unauthenticated"
  | "unverifiable";

export interface PrereqResult {
  /** Set on `claude_auth` when it isn't passing. */
  auth_reason?: ClaudeAuthReason;
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

export type { ProjectEntry } from "@argus/remote-protocol";

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

export type { HostSnapshot } from "@argus/remote-protocol";

export interface RemoteDevicePush {
  environment?: "production" | "sandbox";
  /** Web Push only — the subscription's encryption keys. */
  keys?: { auth: string; p256dh: string };
  service: "apns" | "fcm" | "webpush";
  /** Native device token, or the Web Push endpoint URL. */
  token: string;
  updated_at: number;
}

/**
 * What a device says it is while pairing, for the confirm screen. Its own
 * claim, not a verified fact — it names the product and decides which grants
 * are worth offering, never what the host allows.
 */
export interface PairingClient {
  /** What it runs on, when it knows: "iPhone 17 Pro", "Safari". */
  device?: string;
  kind: "desktop" | "mobile" | "web";
  /** The product: "Argus Remote", "Argus for Mac". */
  product: string;
  version?: string;
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

export type {
  WorktreeRootSource,
  WorktreePurpose,
  WorktreeStorage,
  WorktreeLocationProbe,
  MoveWorktreesPlan,
} from "@argus/remote-protocol";

/** Payload of `session:worktrees-move-progress`. */
export interface MoveWorktreesProgress {
  branch: string;
  done_entries: number;
  index: number;
  repo_root: string;
  session_id: string;
  step: "copying" | "counting" | "moving" | "removing";
  total: number;
  total_entries: number;
}

export type { MoveWorktreesResult } from "@argus/remote-protocol";
