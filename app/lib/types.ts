import type { ShareErrorPayload } from "./shareError";
import type { AgentInfo, Session } from "@argus/remote-protocol";

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

export type { QueuedImage, QueuedMessage } from "@argus/remote-protocol";

/**
 * An agent as the renderer's store holds it: the host's `AgentInfo`, with the
 * fields an optimistic entry can't know yet made optional, plus state only the
 * renderer tracks.
 */
export type AgentStatus = Omit<
  AgentInfo,
  "created_at" | "model" | "parent_agent_id" | "runner_id"
> &
  Partial<
    Pick<AgentInfo, "created_at" | "model" | "parent_agent_id" | "runner_id">
  > & {
    /**
     * Reasoning-effort level (e.g. "low", "medium", "high", "xhigh", "max").
     * `null` / undefined means the model's default. The runner's
     * `apply_flag_settings` control message is the source of truth.
     */
    effort?: string | null;
    /**
     * Prompt sent to an externally-spawned agent (e.g. via the MCP
     * `spawn_agent` tool). Present only on the `agent:started` event — used to
     * derive a session title, since the UI never sees the first user message
     * for MCP-spawned agents.
     */
    initial_prompt?: string;
    /** Claude Code permission mode (e.g. "plan", "default"). */
    permission_mode?: string;
  };

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

export type { ConductorStatus } from "@argus/remote-protocol";

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

export type {
  DependencyReport,
  DependencySeverity,
  DependencyStatus,
} from "@argus/remote-protocol";

export type {
  ArgusRunCommand as RunCommand,
  RelatedProject,
  SimulatorDeeplinkConfig,
  BrowserPresetConfig,
  RuntimePlatform,
} from "@argus/remote-protocol";

export type {
  CustomRunnerConfig,
  CustomRunnerModel,
  CustomRunnerPreset,
  RegisteredRunner,
  RunnerCapabilities,
  RunnerModelOption,
} from "@argus/remote-protocol";

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

export type { AppSettings } from "@argus/remote-protocol";

export type { UserProjectSettings } from "@argus/remote-protocol";

// ---------------------------------------------------------------------------
// Automations
// ---------------------------------------------------------------------------

export type {
  AcceptProposalResult,
  Automation,
  AutomationCalibration,
  AutomationDraft,
  AutomationGuardrails,
  AutomationMemory,
  AutomationMemoryListing,
  AutomationMemoryType,
  AutomationRun,
  AutomationRunFeedback,
  AutomationRunStatus,
  AutomationScratchSpec,
  AutomationTrigger,
  AutomationTriggerKind,
  AutonomyLevel,
  CreateAutomationInput,
  GateLogEntry,
  Proposal,
  ProposalAction,
  ProposalCta,
  ProposalCtaKind,
  ProposalSourceRef,
  ProposalStartStage,
  ProposalStatus,
  RequestRevisionResult,
  SaveAutomationMemoryInput,
  SignalSourceInfo,
  StartScratchRunInput,
  UpdateAutomationInput,
} from "@argus/remote-protocol";

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

export type {
  AgentCapabilities,
  AgentModelInfo as ModelInfo,
  AgentSlashCommand as SlashCommand,
} from "@argus/remote-protocol";

// ---------------------------------------------------------------------------
// Claude account
// ---------------------------------------------------------------------------

export type {
  ClaudeAccount,
  ClaudeAccountsState,
  ClaudeAuthStatus,
} from "@argus/remote-protocol";

// Onboarding
// ---------------------------------------------------------------------------

export { ONBOARDING_STEPS } from "@argus/remote-protocol";
export type {
  ArgusConfigSuggestion,
  ClaudeAuthReason,
  DetectedSignal,
  DetectedSignalKind,
  OnboardingConfigFile,
  OnboardingStateData,
  OnboardingStep,
  PrereqId,
  PrereqResult,
  PrereqStatus,
} from "@argus/remote-protocol";

export type { ProjectEntry } from "@argus/remote-protocol";

export type { ExampleProject } from "@argus/remote-protocol";

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
