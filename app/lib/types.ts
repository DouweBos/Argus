import type {
  AgentInfo,
  DeviceInfo as HostDeviceInfo,
  DevicePlatform as HostDevicePlatform,
  Session,
} from "@argus/remote-protocol";

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

export type {
  ConductorLogEntry,
  DeviceHost,
  DeviceHostInput,
  DeviceHostTestResult,
  DevicePlatform as HostDevicePlatform,
  EasAccount,
  EasDeviceHost,
  EasDeviceHostInput,
  ExpoCredentialSource,
  SimulatorDevice,
  SimulatorProblem,
} from "@argus/remote-protocol";

/** Host platforms plus video inputs, which only the renderer enumerates. */
export type DevicePlatform = HostDevicePlatform | "video";

/** A host's device row, tagged with its host and widened for video inputs. */
export interface DeviceInfo extends Omit<HostDeviceInfo, "platform"> {
  /** Machine the device is attached to. Unset means this Mac. */
  hostId?: string;
  platform: DevicePlatform;
}

export type { ConductorStatus } from "@argus/remote-protocol";

export type { AndroidDevice } from "@argus/remote-protocol";

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
  BrowserDevtools,
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
export type {
  InheritedMcpServer,
  McpOAuthStatus,
  McpTestResult,
  McpTool,
} from "@argus/remote-protocol";

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

export type {
  LlmContentBlock,
  LlmStreamEvent,
  LlmToolResult,
  PermissionCancellation,
  PermissionRequest,
  PermissionSuggestion,
  TokenUsage,
} from "@argus/host/services/agent/conversation/types";

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

export type {
  ClaudeAccountLimits,
  ClaudeUsageLimits,
  ClaudeUsageSummary,
  UsageCostTotals,
  UsageLimitWindow,
  UsageModelRow,
  UsagePace,
  UsageRange,
  UsageSeriesPoint,
  UsageTokenTotals,
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

export type {
  CliProjectCandidate,
  CliProjectImportSource,
  CliProjectScan,
} from "@argus/remote-protocol";

export type { ExampleProject } from "@argus/remote-protocol";

export type {
  InlineReviewComment,
  InterestingPullRequest,
  PullRequestCheck,
  PullRequestComment,
  PullRequestCommit,
  PullRequestDetail,
  PullRequestFile,
  PullRequestReason,
} from "@argus/remote-protocol";

// ---------------------------------------------------------------------------
// Remote access (phone/web control)
// ---------------------------------------------------------------------------

export type { HostSnapshot } from "@argus/remote-protocol";

export type { DevicePushToken as RemoteDevicePush } from "@argus/remote-protocol";

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

export type {
  PairedDevice as RemoteDevice,
  RemoteEndpoint,
  RemotePairingStart,
  RemotePushConfig,
  RemotePushConfigPatch,
  RemotePushTestResult,
  RemoteStatus,
  RemoteTunnelMode,
  RemoteTunnelProvider,
  RemoteTunnelState,
  RemoteTunnelStatus,
  TailscaleDiagnosis,
  TailscaleFixKind,
  TailscaleFixResult,
  TailscaleStep,
  TailscaleStepId,
  TailscaleStepState,
} from "@argus/remote-protocol";

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

export type { ShareReadiness } from "@argus/remote-protocol";

export type {
  DeviceOrientation,
  DisplayInfo,
  FoldPose,
  FoldState,
  SimulatorDeviceState,
} from "@argus/remote-protocol";

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
