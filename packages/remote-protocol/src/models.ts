/**
 * Monitor-scoped mirrors of desktop data. These are deliberately narrower than
 * the desktop's own `Session`/`AgentStatus` — the gateway strips fields the
 * remote client has no business seeing (paths, env indices, tool inputs beyond
 * what a permission decision needs).
 */

import { z } from "zod";

export const RemoteProject = z.object({
  repo_root: z.string(),
  name: z.string(),
  accent: z.string().nullable().optional(),
});
export type RemoteProject = z.infer<typeof RemoteProject>;

export const RemoteSession = z.object({
  id: z.string(),
  repo_root: z.string(),
  kind: z.enum(["automation_host", "project_root", "worktree"]),
  branch: z.string(),
  display_name: z.string().nullable().optional(),
  status: z.enum(["deleting", "initializing", "ready", "error"]),
});
export type RemoteSession = z.infer<typeof RemoteSession>;

export const RemoteAgentStatus = z.object({
  agent_id: z.string(),
  session_id: z.string(),
  /** Human label for the agent's session (branch / display name / "project root"). */
  session_label: z.string().optional(),
  /** Repository the agent's session belongs to, for cross-project lists. */
  project_name: z.string().optional(),
  /** Generated conversation title, if one has been produced. */
  title: z.string().nullable().optional(),
  status: z.enum(["error", "idle", "requires_action", "running", "stopped"]),
  model: z.string().nullable().optional(),
  /** Current permission mode, so a control client can show/cycle it. */
  permission_mode: z.string().nullable().optional(),
  parent_agent_id: z.string().nullable().optional(),
  created_at: z.number().optional(),
  /** Unix ms of the agent's most recent stream event — its last sign of life. */
  last_activity_at: z.number().optional(),
  /**
   * What the agent is blocked on the user for, if anything. Derived host-side
   * so a client can flag it without holding the transcript.
   */
  awaiting: z.enum(["permission", "question", "plan"]).nullable().optional(),
});
export type RemoteAgentStatus = z.infer<typeof RemoteAgentStatus>;

/**
 * A finished agent conversation saved to the project's chat history — what a
 * remote sees of an agent that has already stopped. Addressed by `history_id`
 * rather than an agent id, since the agent itself is long gone.
 */
export const RemoteStoppedAgent = z.object({
  history_id: z.string(),
  /** Runner session id, so a control client can resume the conversation. */
  runner_session_id: z.string(),
  title: z.string(),
  branch: z.string(),
  description: z.string().optional(),
  model: z.string().nullable().optional(),
  message_count: z.number().int().nonnegative(),
  started_at: z.number(),
  ended_at: z.number(),
});
export type RemoteStoppedAgent = z.infer<typeof RemoteStoppedAgent>;

/** A message waiting for a busy agent's turn to end. Stored on the desktop. */
export const RemoteQueuedMessage = z.object({
  id: z.string(),
  /** What will be sent — may carry a preamble the user never typed. */
  text: z.string(),
  /** What to show instead, when it differs from `text`. */
  display_text: z.string().optional(),
  /** Who queued it, when a huddle guest rather than the host did. */
  author: z.string().optional(),
  images: z
    .array(z.object({ data: z.string(), media_type: z.string() }))
    .optional(),
  queued_at: z.number(),
});
export type RemoteQueuedMessage = z.infer<typeof RemoteQueuedMessage>;

/**
 * Reference to an image whose bytes live in the desktop snapshot. The client
 * fetches the base64 payload lazily via `agents.image` keyed by `image_id`,
 * so transcripts stay cheap to re-fetch on every live event.
 */
export const RemoteImageRef = z.object({
  image_id: z.string(),
  media_type: z.string(),
});
export type RemoteImageRef = z.infer<typeof RemoteImageRef>;

/** A single block of a tool result — text or an image reference. */
export const RemoteToolResultBlock = z.discriminatedUnion("type", [
  z.object({ type: z.literal("text"), text: z.string() }),
  z.object({
    type: z.literal("image"),
    image_id: z.string(),
    media_type: z.string(),
  }),
]);
export type RemoteToolResultBlock = z.infer<typeof RemoteToolResultBlock>;

/** A tool invocation within an assistant message (structure-preserving). */
export interface RemoteToolCall {
  id: string;
  name: string;
  input: Record<string, unknown>;
  /** Rich result blocks (text + image references), in order. */
  result_blocks: RemoteToolResultBlock[];
  /** Nested sub-agent activity for Task/Agent tool calls. */
  children?: RemoteToolCallChild[];
  /** Whether this call is awaiting a user permission decision. */
  pending_permission?: boolean;
  is_error?: boolean;
  status: "done" | "error" | "pending" | "running";
}

/** Sub-agent output nested under a Task/Agent tool call. */
export type RemoteToolCallChild =
  | { kind: "text"; text: string }
  | { kind: "tool_use"; tool_call: RemoteToolCall };

export const RemoteToolCall: z.ZodType<RemoteToolCall> = z.lazy(() =>
  z.object({
    id: z.string(),
    name: z.string(),
    input: z.record(z.string(), z.unknown()),
    result_blocks: z.array(RemoteToolResultBlock),
    children: z.array(RemoteToolCallChild).optional(),
    pending_permission: z.boolean().optional(),
    is_error: z.boolean().optional(),
    status: z.enum(["done", "error", "pending", "running"]),
  }),
);

export const RemoteToolCallChild: z.ZodType<RemoteToolCallChild> = z.lazy(() =>
  z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("text"), text: z.string() }),
    z.object({ kind: z.literal("tool_use"), tool_call: RemoteToolCall }),
  ]),
);

/** Origin metadata for system messages (e.g. MCP tool injections). */
export const RemoteMessageSource = z.object({
  kind: z.literal("mcp"),
  tool: z.string(),
  parent_agent_id: z.string().nullable().optional(),
  parent_label: z.string().nullable().optional(),
});
export type RemoteMessageSource = z.infer<typeof RemoteMessageSource>;

/** Anthropic token usage for an assistant turn, used to gauge context fill. */
export const RemoteTokenUsage = z.object({
  input_tokens: z.number(),
  output_tokens: z.number(),
  cache_read_input_tokens: z.number().optional(),
  cache_creation_input_tokens: z.number().optional(),
});
export type RemoteTokenUsage = z.infer<typeof RemoteTokenUsage>;

/** A structured transcript message mirroring the desktop conversation. */
export const RemoteMessage = z.object({
  id: z.string(),
  role: z.enum(["assistant", "system", "user"]),
  text_blocks: z.array(z.string()),
  tool_calls: z.array(RemoteToolCall),
  /** Image attachments carried by the message (user/MCP), as references. */
  images: z.array(RemoteImageRef).optional(),
  source: RemoteMessageSource.optional(),
  /** Who sent a user message, when it came from a remote client or huddle guest. */
  author: z.string().optional(),
  is_error: z.boolean().optional(),
  timestamp: z.number().optional(),
  /** Token usage (assistant turns only) — drives the context-window meter. */
  usage: RemoteTokenUsage.optional(),
});
export type RemoteMessage = z.infer<typeof RemoteMessage>;

/** A task authored via the stateful Task* tool family. */
export const RemoteTask = z.object({
  id: z.string(),
  subject: z.string(),
  status: z.enum(["completed", "in_progress", "pending"]),
  description: z.string().optional(),
  activeForm: z.string().optional(),
  owner: z.string().optional(),
  blocks: z.array(z.string()).optional(),
  blockedBy: z.array(z.string()).optional(),
});
export type RemoteTask = z.infer<typeof RemoteTask>;

/** A todo-list entry authored via TodoWrite. */
export const RemoteTodo = z.object({
  content: z.string(),
  status: z.enum(["completed", "in_progress", "pending"]),
  activeForm: z.string().optional(),
});
export type RemoteTodo = z.infer<typeof RemoteTodo>;

export const RemoteAgentVitals = z.object({
  agent_id: z.string(),
  status: z.string(),
  last_event_at: z.number().nullable().optional(),
  tool_uses_total: z.number(),
  last_tool_name: z.string().nullable().optional(),
  last_tool_use_at: z.number().nullable().optional(),
  turns_completed: z.number(),
});
export type RemoteAgentVitals = z.infer<typeof RemoteAgentVitals>;

/**
 * A permission prompt forwarded to the client. `tool_input` is passed through
 * so the user can see what they're approving, but the client can only reply
 * allow/deny — never inject allow-rules.
 */
export const RemotePermissionRequest = z.object({
  agent_id: z.string(),
  tool_use_id: z.string(),
  tool_name: z.string(),
  tool_input: z.record(z.string(), z.unknown()),
});
export type RemotePermissionRequest = z.infer<typeof RemotePermissionRequest>;

/**
 * A connected simulator/emulator the remote client can view and control.
 * `width/height` are only known once a stream's H.264 config has been seen.
 */
export const RemoteDevice = z.object({
  id: z.string(),
  platform: z.enum(["ios", "android"]),
  name: z.string(),
  runtime: z.string().nullable().optional(),
  booted: z.boolean(),
  /** TV form factor (Apple TV / Android TV) — driven by the dpad, not touch. */
  is_tv: z.boolean(),
  /** Whether a capture session is currently active (driven by remote demand). */
  capturing: z.boolean(),
  width: z.number().optional(),
  height: z.number().optional(),
});
export type RemoteDevice = z.infer<typeof RemoteDevice>;

/** Named hinge poses, matching conductor's vocabulary. */
export const RemoteFoldPose = z.enum(["book", "closed", "open", "partial"]);
export type RemoteFoldPose = z.infer<typeof RemoteFoldPose>;

export const RemoteDeviceOrientation = z.enum([
  "landscapeLeft",
  "landscapeRight",
  "portrait",
  "portraitUpsideDown",
]);
export type RemoteDeviceOrientation = z.infer<typeof RemoteDeviceOrientation>;

/**
 * How the device is being held. A client has to know: the framebuffer is
 * panel-native, so a rotated device arrives sideways in the stream, and a
 * folded Duo lights a different panel at a different size.
 */
export const RemoteDeviceState = z.object({
  device_id: z.string(),
  /** Null on devices with no hinge, which is every simulator but the Duo. */
  fold: z
    .object({ angle: z.number(), pose: RemoteFoldPose })
    .nullable()
    .default(null),
  orientation: RemoteDeviceOrientation,
  /** Null while nothing is being captured. */
  display: z
    .object({
      width: z.number(),
      height: z.number(),
      /** Clockwise degrees the client must rotate the stream by to sit upright. */
      rotation: z.union([
        z.literal(0),
        z.literal(90),
        z.literal(180),
        z.literal(270),
      ]),
      screen_id: z.number(),
    })
    .nullable()
    .default(null),
});
export type RemoteDeviceState = z.infer<typeof RemoteDeviceState>;

/**
 * Who currently holds interaction on a device. Two clients may both watch a
 * screen, but only the holder may inject HID events.
 */
export const RemoteDeviceClaim = z.object({
  connection_id: z.string(),
  /** The paired device (phone/Mac) holding the claim, not the simulator. */
  device_id: z.string(),
  label: z.string(),
});
export type RemoteDeviceClaim = z.infer<typeof RemoteDeviceClaim>;

/**
 * Who holds a claim, and on what. The one shape the host publishes for a claim
 * change and attaches to a refused input, so the typed `devices.*` path and the
 * raw admin path tell every client the same thing.
 */
export const RemoteDeviceClaimState = z.object({
  device_id: z.string(),
  holder: RemoteDeviceClaim.nullable(),
});
export type RemoteDeviceClaimState = z.infer<typeof RemoteDeviceClaimState>;

/** Namespace prefix keeping browser claims out of the simulator UDID space. */
export const BROWSER_CLAIM_PREFIX = "browser:";

/**
 * Claim key for an embedded browser session. Shared vocabulary: the host keys
 * its claim table with it and clients pass the same string to
 * `devices.claim` / `devices.release` / `devices.claim_status`.
 */
export function browserClaimId(sessionId: string): string {
  return `${BROWSER_CLAIM_PREFIX}${sessionId}`;
}

export const RemoteOrganization = z.object({
  id: z.string(),
  name: z.string(),
  accent: z.string().nullable().optional(),
  member_repo_roots: z.array(z.string()),
});
export type RemoteOrganization = z.infer<typeof RemoteOrganization>;

// --- Control-scoped models (mirror app/lib/types.ts input shapes) ----------

/** A model the agent can switch to, plus its effort/fast-mode support. */
export const RemoteModelInfo = z.object({
  value: z.string(),
  displayName: z.string(),
  description: z.string(),
  supportsEffort: z.boolean().optional(),
  supportedEffortLevels: z.array(z.string()).optional(),
  supportsFastMode: z.boolean().optional(),
});
export type RemoteModelInfo = z.infer<typeof RemoteModelInfo>;

/** A slash command surfaced in the input's autocomplete. */
export const RemoteSlashCommand = z.object({
  name: z.string(),
  description: z.string(),
  argumentHint: z.string(),
});
export type RemoteSlashCommand = z.infer<typeof RemoteSlashCommand>;

/** A subagent type the user can @-invoke. */
export const RemoteSubagentType = z.object({
  name: z.string(),
  description: z.string(),
  model: z.string().optional(),
});
export type RemoteSubagentType = z.infer<typeof RemoteSubagentType>;

/** Everything the input pickers need for one agent. */
export const RemoteAgentCapabilities = z.object({
  models: z.array(RemoteModelInfo),
  commands: z.array(RemoteSlashCommand),
  agents: z.array(RemoteSubagentType),
});
export type RemoteAgentCapabilities = z.infer<typeof RemoteAgentCapabilities>;

/** One entry in the @-mention browse listing. */
export const RemoteMentionEntry = z.object({
  name: z.string(),
  is_dir: z.boolean(),
});
export type RemoteMentionEntry = z.infer<typeof RemoteMentionEntry>;

export const RemoteMentionPathResult = z.object({
  entries: z.array(RemoteMentionEntry),
  resolved_path: z.string(),
});
export type RemoteMentionPathResult = z.infer<typeof RemoteMentionPathResult>;

/** An image attachment sent up with a chat message (base64, no data-URL prefix). */
export const RemoteImageAttachment = z.object({
  data: z.string(),
  media_type: z.string(),
});
export type RemoteImageAttachment = z.infer<typeof RemoteImageAttachment>;

/** An in-progress git operation (merge/rebase/etc.), for the status header. */
export const RemoteGitInProgress = z.object({
  kind: z.enum(["bisect", "cherry-pick", "merge", "rebase"]),
  head: z.string(),
  onto: z.string().optional(),
});
export type RemoteGitInProgress = z.infer<typeof RemoteGitInProgress>;

/** Read-only git status for a session (mirror of the desktop's GitStatus). */
export const RemoteGitStatus = z.object({
  branch: z.string(),
  upstream: z.string().nullable(),
  ahead: z.number(),
  behind: z.number(),
  dirty_count: z.number(),
  stash_count: z.number(),
  conflict_count: z.number(),
  detached: z.boolean(),
  last_fetch_at: z.number().nullable(),
  in_progress: RemoteGitInProgress.nullable(),
  /** Added/removed line counts across committed + working + untracked diffs. */
  diff_additions: z.number().optional(),
  diff_deletions: z.number().optional(),
});
export type RemoteGitStatus = z.infer<typeof RemoteGitStatus>;

/**
 * A branch offered to a remote client's branch switcher. `name` is always the
 * checkout target: for remote-only branches that's the short name, which git
 * DWIMs into a local tracking branch.
 */
export const RemoteGitBranch = z.object({
  name: z.string(),
  scope: z.enum(["local", "remote"]),
  /** Remote it lives on ("origin"), for scope "remote". */
  remote: z.string().optional(),
  is_current: z.boolean(),
  upstream: z.string().nullable().optional(),
  ahead: z.number().int().nonnegative(),
  behind: z.number().int().nonnegative(),
  last_commit_subject: z.string().optional(),
  last_commit_at: z.number().optional(),
});
export type RemoteGitBranch = z.infer<typeof RemoteGitBranch>;

/**
 * One address a phone can reach this desktop on. Desktops expose several at
 * once (LAN, Tailscale, Cloudflare); clients probe them and keep the
 * best-ranked one that completes a handshake. Lower `priority` is simpler.
 */
export const RemoteEndpoint = z.object({
  kind: z.enum(["lan", "tailscale", "cloudflare"]),
  url: z.string(),
  priority: z.number().int().nonnegative(),
});
export type RemoteEndpoint = z.infer<typeof RemoteEndpoint>;

// --- Automations -----------------------------------------------------------

/**
 * An automation, as a client that only views and fires them needs it.
 *
 * Deliberately not the whole `Automation`: the playbook, guardrails and signal
 * sources are what you edit, and editing one from a phone is not a thing. A
 * client that wants the full object is another desktop, and it rides the admin
 * passthrough instead.
 */
export const RemoteAutomation = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  enabled: z.boolean(),
  trigger_kind: z.enum(["manual", "schedule"]),
  /** 5-field cron and its IANA zone — only for `schedule`. */
  cron: z.string().nullable(),
  timezone: z.string().nullable(),
  /** The rung it runs at, or null when it inherits the host's default. */
  autonomy: z.enum(["auto_merge", "draft", "pr", "propose"]).nullable(),
  /** Project names it may look at — paths mean nothing on a phone. */
  projects: z.array(z.string()),
  last_run_at: z.number().nullable(),
  next_run_at: z.number().nullable(),
  /** Whether a run of this automation is in flight right now. */
  running: z.boolean(),
});
export type RemoteAutomation = z.infer<typeof RemoteAutomation>;

export const RemoteAutomationRunStatus = z.enum([
  "cancelled",
  "failed",
  "queued",
  "running",
  "skipped",
  "succeeded",
]);
export type RemoteAutomationRunStatus = z.infer<
  typeof RemoteAutomationRunStatus
>;

/**
 * One firing. `automation_name` is resolved host-side — a quick run has no
 * automation to join against, and the client should not have to know that.
 */
export const RemoteAutomationRun = z.object({
  id: z.string(),
  automation_id: z.string(),
  automation_name: z.string(),
  /** True for an ad-hoc run: nothing is persisted behind it. */
  is_quick: z.boolean(),
  status: RemoteAutomationRunStatus,
  trigger_reason: z.string(),
  started_at: z.number(),
  finished_at: z.number().nullable(),
  cost_usd: z.number().nullable(),
  error: z.string().nullable(),
  /** It wrote a report, nobody has read it, and nothing newer has replaced it. */
  unread_report: z.boolean(),
  /** The run's own session, so a client can open the agent that did the work. */
  host_session_id: z.string().nullable(),
  host_agent_id: z.string().nullable(),
});
export type RemoteAutomationRun = z.infer<typeof RemoteAutomationRun>;

// --- Proposals -------------------------------------------------------------

/** The one action a proposal asks for. The `delete_` kinds are destructive. */
export const RemoteProposalCta = z.object({
  kind: z.enum([
    "delete_branch",
    "delete_session",
    "open_url",
    "start_session",
  ]),
  /** Button text, written by the run: "Start", "Open PR #6478". */
  label: z.string(),
  /** Where `open_url` goes. Null for every other kind. */
  url: z.string().nullable(),
  /** Branch a `delete_branch` clears, in the proposal's own project. */
  branch: z.string().nullable(),
  /** `git branch -D` rather than `-d`. */
  force: z.boolean(),
  /** Session a `delete_session` retires. */
  session_id: z.string().nullable(),
});
export type RemoteProposalCta = z.infer<typeof RemoteProposalCta>;

export const RemoteProposalStatus = z.enum([
  "accepted",
  "auto_started",
  "dismissed",
  "pending",
  /** Cleared by a later run of the same automation, not by the user. */
  "superseded",
  "withdrawn",
]);
export type RemoteProposalStatus = z.infer<typeof RemoteProposalStatus>;

/**
 * One thing an automation wants you to decide on, as a phone needs it.
 *
 * The automation's name and the project's are resolved host-side for the same
 * reason the run's is: a phone has no automations file to join against, and no
 * business knowing a path on someone else's disk.
 */
export const RemoteProposal = z.object({
  id: z.string(),
  automation_id: z.string(),
  automation_name: z.string(),
  title: z.string(),
  /** What the work is, in markdown. */
  summary: z.string(),
  /** Why the run ranked it where it did. */
  rationale: z.string(),
  /** 0..1, self-reported by the run's agent. */
  confidence: z.number(),
  cta: RemoteProposalCta.nullable(),
  status: RemoteProposalStatus,
  /** Project the work would happen in, by name. Null when it maps to none. */
  project: z.string().nullable(),
  /** The work item it came from, e.g. `plexinc/app#412`, and where it lives. */
  source_label: z.string().nullable(),
  source_url: z.string().nullable(),
  /** Set once it has been started — the session doing the work. */
  session_id: z.string().nullable(),
  created_at: z.number(),
});
export type RemoteProposal = z.infer<typeof RemoteProposal>;
