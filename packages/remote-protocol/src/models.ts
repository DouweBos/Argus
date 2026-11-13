/**
 * Monitor-scoped mirrors of desktop data. These are deliberately narrower than
 * the desktop's own `Session`/`AgentStatus` — the gateway strips fields the
 * remote client has no business seeing (paths, env indices, tool inputs beyond
 * what a permission decision needs).
 */

import { z } from "zod";
import { DesignRef, LinkedIssue } from "./models/integrations";
import { SessionPullRequest } from "./models/sessions";

export const RemoteProject = z.object({
  repo_root: z.string(),
  name: z.string(),
  accent: z.string().nullable().optional(),
});
export type RemoteProject = z.infer<typeof RemoteProject>;

export const RemoteSession = z.object({
  id: z.string(),
  repo_root: z.string(),
  kind: z.enum(["automation_host", "project_root", "scratch_pad", "worktree"]),
  branch: z.string(),
  display_name: z.string().nullable().optional(),
  /** The branch a merge lands on. Absent on older hosts. */
  base_branch: z.string().nullable().optional(),
  /** Claude account the session is pinned to; null follows the active one. */
  claude_account_id: z.string().nullable().optional(),
  status: z.enum(["deleting", "initializing", "ready", "error"]),
  /** Why setup failed while `status` is `error`. Absent on older hosts. */
  setup_error: z.string().nullable().optional(),
  /**
   * How far setup or removal has got while `status` is `initializing` or
   * `deleting`. Absent before the first count, and on older hosts.
   */
  progress: z
    .object({
      current: z.number(),
      total: z.number(),
      /** `teardown` while the project's teardown commands run. */
      phase: z.enum(["teardown"]).nullish(),
      /** The running step's latest output line. */
      detail: z.string().nullish(),
    })
    .nullable()
    .optional(),
  /**
   * Which step of the last delete failed while `status` is `error`; null when
   * it was setup that failed. Absent on older hosts.
   */
  delete_failed: z.enum(["remove", "teardown"]).nullish(),
  /**
   * Whether the session's files are reachable. Orthogonal to `status`: the
   * usual cause is the external drive holding its worktree being unplugged
   * from the host, which a phone can do nothing about but should still show.
   * Absent means available, so older hosts read correctly.
   */
  availability: z.enum(["available", "unavailable"]).optional(),
  /** Name of the drive to reconnect, e.g. "Blackbox". Not its mount path. */
  unavailable_volume: z.string().nullable().optional(),
  /** Name of the external drive holding the session; null on the boot volume. */
  volume: z.string().nullable().optional(),
  /** The tracker issue the session was started from. Absent on older hosts. */
  linked_issue: LinkedIssue.nullable().optional(),
  /** The Figma frames its work should match. Absent on older hosts. */
  design_refs: z.array(DesignRef).nullable().optional(),
  /** Made outside Argus, so the project's setup never ran in it. Absent on older hosts. */
  setup_pending: z.boolean().optional(),
  /** The branch's GitHub pull request, null when none. Absent on older hosts. */
  pull_request: SessionPullRequest.nullable().optional(),
  /** An agent is woken on this PR's CI results, conflicts and comments. Absent on older hosts. */
  pull_request_watched: z.boolean().optional(),
  /** Marked done (true) or kept active (false); null follows the pull request. Absent on older hosts. */
  settled: z.boolean().nullable().optional(),
  /** Hidden until this epoch ms. Absent on older hosts. */
  snoozed_until: z.number().nullable().optional(),
  /** A turn finished while no client had it open. Absent on older hosts. */
  unread: z.boolean().optional(),
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
  /** Context window in tokens as the CLI last reported it; null before the first turn ends. */
  context_window: z.number().nullable().optional(),
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
  /** Unix ms a "continue" is scheduled for after a spent usage limit resets. */
  limit_resume_at: z.number().nullable().optional(),
  /** The last turn ended on a spent usage limit and none has got through since. */
  limit_stalled: z.boolean().optional(),
  /** Effort last set on the agent; absent while it runs on the model's default. */
  effort: z.string().optional(),
  /** Runner session id once the runner reported one, so a stopped agent can be resumed. */
  runner_session_id: z.string().optional(),
  /** The runner it runs on, so a resume picks the same one. */
  runner_id: z.string().optional(),
  /** Resumed automatically when the host restarts. Absent on older hosts. */
  pinned: z.boolean().optional(),
  /** Claude account its process runs as, which can differ from the computer's current default. Absent on older hosts. */
  account_id: z.string().optional(),
});
export type RemoteAgentStatus = z.infer<typeof RemoteAgentStatus>;

/**
 * A finished agent conversation saved to the project's chat history — what a
 * remote sees of an agent that has already stopped. Addressed by `history_id`
 * rather than an agent id, since the agent itself is long gone.
 */
export const RemoteStoppedAgent = z.object({
  history_id: z.string(),
  /** The agent that ran it, so a link to that agent can resume it. Absent on older records. */
  agent_id: z.string().optional(),
  /** Runner session id, so a control client can resume the conversation. */
  runner_session_id: z.string(),
  title: z.string(),
  branch: z.string(),
  description: z.string().optional(),
  model: z.string().nullable().optional(),
  message_count: z.number().int().nonnegative(),
  started_at: z.number(),
  ended_at: z.number(),
  /** Set when the chat was read in from another app's history, not run here. */
  imported_from: z.enum(["claude_code"]).optional(),
  /** The runner it ran on, so a resume picks the same one. Absent on older hosts. */
  runner_id: z.string().optional(),
  /** Permission mode and effort it last ran with, so a resume keeps them. Absent on older records. */
  permission_mode: z.string().optional(),
  effort: z.string().optional(),
  /** Pinned: the host resumes it on its next start. Absent on older hosts. */
  pinned: z.boolean().optional(),
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
 * Reference to an image whose bytes live in the host's transcript. The client
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

/** How a call launched with `run_in_background` is getting on. */
export const RemoteBackgroundTask = z.object({
  status: z.enum(["completed", "failed", "running", "stopped"]),
  /** Epoch milliseconds. */
  started_at: z.number(),
  duration_ms: z.number().optional(),
});
export type RemoteBackgroundTask = z.infer<typeof RemoteBackgroundTask>;

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
  /** A prompt that lapsed unanswered; it can no longer be answered. */
  expired?: boolean;
  is_error?: boolean;
  status: "done" | "error" | "pending" | "running";
  /** Set when the call runs in the background past its own tool_result. */
  background?: RemoteBackgroundTask;
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
    expired: z.boolean().optional(),
    is_error: z.boolean().optional(),
    status: z.enum(["done", "error", "pending", "running"]),
    background: RemoteBackgroundTask.optional(),
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

/** The divider where a chat moved from one runner to another. */
export const RemoteMessageHandoff = z.object({
  from_agent_id: z.string(),
  from_runner: z.string(),
  to_runner: z.string(),
});
export type RemoteMessageHandoff = z.infer<typeof RemoteMessageHandoff>;

/** A message that was one of the runner's own slash commands. */
export const RemoteMessageCommand = z.object({
  name: z.string(),
  /** Whatever followed the command's name. */
  args: z.string().optional(),
});
export type RemoteMessageCommand = z.infer<typeof RemoteMessageCommand>;

/** A structured transcript message mirroring the desktop conversation. */
export const RemoteMessage = z.object({
  id: z.string(),
  role: z.enum(["assistant", "system", "user"]),
  text_blocks: z.array(z.string()),
  tool_calls: z.array(RemoteToolCall),
  /** Image attachments carried by the message (user/MCP), as references. */
  images: z.array(RemoteImageRef).optional(),
  source: RemoteMessageSource.optional(),
  handoff: RemoteMessageHandoff.optional(),
  /** Who sent a user message, when it came from a remote client or huddle guest. */
  author: z.string().optional(),
  /** Set when the message was one of the runner's slash commands. */
  command: RemoteMessageCommand.optional(),
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

/** One MCP server as the agent's CLI sees it right now. */
export const RemoteMcpServerStatus = z.object({
  name: z.string(),
  /** `connected`, `pending`, `needs-auth`, `failed` or `disabled`; open for new CLI states. */
  status: z.string(),
  /** Where the config came from: `user`, `project`, `plugin`, `claudeai`, … */
  source: z.string().nullable().optional(),
  tool_count: z.number().nullable().optional(),
  error: z.string().nullable().optional(),
});
export type RemoteMcpServerStatus = z.infer<typeof RemoteMcpServerStatus>;

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
  /** Label of the device host (another Mac over SSH) it runs on; absent here. */
  device_host_label: z.string().optional(),
});
export type RemoteDevice = z.infer<typeof RemoteDevice>;

/**
 * A device host as a paired client sees it: no SSH target, key path, Expo
 * token or project. `kind` is absent from hosts that predate EAS hosts.
 */
export const RemoteDeviceHost = z.object({
  id: z.string(),
  label: z.string(),
  status: z.enum(["connected", "unknown", "unreachable"]),
  kind: z.enum(["eas", "ssh"]).optional(),
  /** EAS only: sessions running or starting, and the host's limit. */
  running_sessions: z.number().int().nonnegative().optional(),
  max_sessions: z.number().int().positive().optional(),
});
export type RemoteDeviceHost = z.infer<typeof RemoteDeviceHost>;

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
  /**
   * Clients whose input was refused a moment ago because someone else holds
   * the device — they are tapping at a picture that isn't answering. Short
   * lived: someone who has stopped trying stops being listed.
   */
  waiting: z.array(RemoteDeviceClaim).default([]),
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
  /** The model id an alias (`opus`, `default`) currently runs. */
  resolvedModel: z.string().optional(),
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

/** A session's live terminal: a shell, or one of the project's run commands. */
export const RemoteTerminal = z.object({
  id: z.string(),
  title: z.string().nullable(),
  /** The `.argus.json` run command it runs, if it is one. */
  run_title: z.string().nullable(),
});
export type RemoteTerminal = z.infer<typeof RemoteTerminal>;

/** What a terminal has printed, as plain text with colours stripped. */
export const RemoteTerminalOutput = z.object({
  output: z.string(),
  running: z.boolean(),
  exit_code: z.number().nullable(),
  /** Older output was dropped; this is the tail. */
  truncated: z.boolean(),
});
export type RemoteTerminalOutput = z.infer<typeof RemoteTerminalOutput>;

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
  /** Pinned in this project on the computer; absent from older hosts. */
  pinned: z.boolean().optional(),
});
export type RemoteGitBranch = z.infer<typeof RemoteGitBranch>;

/** One prompt an agent ran in a session, for diffs scoped to what it changed. */
export const RemoteSessionTurn = z.object({
  /** 1-based, oldest first, across every agent in the session. */
  number: z.number().int().positive(),
  checkpoint_id: z.string(),
  agent_id: z.string(),
  /** The prompt's first line, cut short. */
  prompt: z.string(),
  timestamp: z.number(),
});
export type RemoteSessionTurn = z.infer<typeof RemoteSessionTurn>;

/** One commit in a branch's history. */
export const RemoteCommit = z.object({
  hash: z.string(),
  short_hash: z.string(),
  subject: z.string(),
  body: z.string(),
  author: z.string(),
  /** ISO 8601 author date. */
  date: z.string(),
  /** Decorations, as `git log --decorate=short` prints them. */
  refs: z.string(),
});
export type RemoteCommit = z.infer<typeof RemoteCommit>;

/** A commit on only one side of a comparison. */
export const RemoteCommitSummary = z.object({
  hash: z.string(),
  subject: z.string(),
  author: z.string(),
  /** Unix ms. */
  timestamp: z.number(),
});
export type RemoteCommitSummary = z.infer<typeof RemoteCommitSummary>;

/** How two branches diverged. */
export const RemoteBranchCompare = z.object({
  left_only: z.array(RemoteCommitSummary),
  right_only: z.array(RemoteCommitSummary),
  merge_base: z.string().nullable(),
  /** Best-effort: `git merge-tree` saw conflicts. */
  would_conflict: z.boolean(),
});
export type RemoteBranchCompare = z.infer<typeof RemoteBranchCompare>;

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
  trigger_kind: z.enum(["manual", "once", "schedule"]),
  /** 5-field cron — only for `schedule`. */
  cron: z.string().nullable(),
  /** Local `YYYY-MM-DDTHH:mm` — only for `once`. Missing from older hosts. */
  run_at: z.string().nullable().optional(),
  /** IANA zone `cron` or `run_at` is read in. */
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

/** A pull request as a list reads it. */
export const RemotePullRequest = z.object({
  number: z.number(),
  title: z.string(),
  /** `owner/repo`, which is also how the write methods address it. */
  repo: z.string(),
  /** The Argus project this PR's repo maps to, for opening a session on it. */
  repo_root: z.string(),
  author: z.string().nullable(),
  is_draft: z.boolean(),
  /** `APPROVED` | `CHANGES_REQUESTED` | `REVIEW_REQUIRED` | null. */
  review_decision: z.string().nullable(),
  head_ref: z.string(),
  base_ref: z.string(),
  url: z.string(),
  updated_at: z.string(),
  /** Why it is in your list: assigned, review requested, authored by you… */
  reasons: z.array(z.string()),
});
export type RemotePullRequest = z.infer<typeof RemotePullRequest>;

export const RemotePullRequestCheck = z.object({
  name: z.string(),
  status: z.string().nullable(),
  conclusion: z.string().nullable(),
});
export type RemotePullRequestCheck = z.infer<typeof RemotePullRequestCheck>;

export const RemotePullRequestComment = z.object({
  id: z.string(),
  author: z.string().nullable(),
  body: z.string(),
  created_at: z.string(),
  kind: z.enum(["issue", "review"]),
  /** Review verdict for a `review` entry. */
  review_state: z.string().nullable(),
});
export type RemotePullRequestComment = z.infer<typeof RemotePullRequestComment>;

/**
 * One pull request, narrowed for a phone: the body, whether CI is happy, and
 * the conversation. The file-by-file diff stays on the desktop.
 */
export const RemotePullRequestDetail = z.object({
  number: z.number(),
  title: z.string(),
  repo: z.string(),
  url: z.string(),
  author: z.string().nullable(),
  body: z.string(),
  state: z.string(),
  is_draft: z.boolean(),
  merged: z.boolean(),
  /** GitHub's own word: `MERGEABLE`, `CONFLICTING`, `UNKNOWN`. */
  mergeable: z.string(),
  head_ref: z.string(),
  base_ref: z.string(),
  additions: z.number(),
  deletions: z.number(),
  changed_files: z.number(),
  checks: z.array(RemotePullRequestCheck),
  comments: z.array(RemotePullRequestComment),
});
export type RemotePullRequestDetail = z.infer<typeof RemotePullRequestDetail>;

/** A file ticked as viewed; `changed` once it changed after the tick. */
export const RemoteViewedFile = z.object({
  path: z.string(),
  state: z.enum(["viewed", "changed"]),
});
export type RemoteViewedFile = z.infer<typeof RemoteViewedFile>;

/** The limits a run is held to, whatever its playbook says. */
export const RemoteAutomationGuardrails = z.object({
  confidence_threshold: z.number(),
  max_concurrent_sessions: z.number(),
  max_files_changed: z.number(),
  max_cost_usd_per_run: z.number(),
  max_run_minutes: z.number(),
  path_denylist: z.array(z.string()),
  require_clean_ci: z.boolean(),
  // Optional so a phone that predates it can still save; the host defaults it.
  retry_other_accounts: z.boolean().optional(),
});
export type RemoteAutomationGuardrails = z.infer<
  typeof RemoteAutomationGuardrails
>;

/** A signal source an automation can subscribe to, and whether it works here. */
export const RemoteSignalSource = z.object({
  id: z.string(),
  label: z.string(),
  /** `native` = Argus fetches it; `agent` = the run's agent fetches it. */
  mode: z.enum(["agent", "native"]),
  /** False when the source has nothing to answer with — no `gh`, no MCP. */
  available: z.boolean(),
});
export type RemoteSignalSource = z.infer<typeof RemoteSignalSource>;

/** A model a runner declares up front. Empty for runners that learn theirs. */
export const RemoteRunnerModel = z.object({
  value: z.string(),
  display_name: z.string(),
  description: z.string().nullable(),
});
export type RemoteRunnerModel = z.infer<typeof RemoteRunnerModel>;

/** One file in an automation's memory. Mirrors the host's `AutomationMemory`. */
export const RemoteAutomationMemory = z.object({
  name: z.string(),
  description: z.string(),
  type: z.enum(["user", "feedback", "project", "reference"]),
  body: z.string(),
  updated_at: z.number(),
});
export type RemoteAutomationMemory = z.infer<typeof RemoteAutomationMemory>;

/** An LLM runner an automation can be pinned to. Mirrors `RegisteredRunner`. */
export const RemoteRunner = z.object({
  id: z.string(),
  display_name: z.string(),
  is_custom: z.boolean(),
  default_model: z.string().nullable(),
  models: z.array(RemoteRunnerModel),
  /**
   * What the runner's CLI last reported in its handshake, kept by the host
   * across restarts — a start's model and effort before any agent has run.
   */
  reported_models: z.array(RemoteModelInfo).optional(),
  /** Rewind and fork a chat; absent from older hosts, where every runner could. */
  supports_transcript_fork: z.boolean().optional(),
  /** Side questions to a running agent; absent from older hosts. */
  supports_side_question: z.boolean().optional(),
  /** False when its CLI isn't installed; absent from older hosts, where all were. */
  available: z.boolean().optional(),
  /** How to install it, when unavailable. */
  unavailable_reason: z.string().nullable().optional(),
  /** How Argus installs and signs in to it; absent when it can't. */
  setup: z
    .object({
      install_command: z.string().nullable(),
      install_url: z.string().nullable(),
      login_command: z.string().nullable(),
    })
    .nullable()
    .optional(),
});
export type RemoteRunner = z.infer<typeof RemoteRunner>;

/**
 * A signed-in Claude account on the host. Mirrors the host's `ClaudeAccount`.
 * `rate_limited` and `needs_reauth` are two different problems: the first means
 * the plan's quota is spent and the credentials are fine, the second that the
 * stored token is dead. Collapsing them would send users to re-login for free.
 */
export const RemoteClaudeAccount = z.object({
  id: z.string(),
  /** User-editable display name; falls back to `email`. */
  label: z.string().nullable(),
  email: z.string().nullable(),
  org_name: z.string().nullable(),
  subscription_type: z.string().nullable(),
  needs_reauth: z.boolean(),
  rate_limited: z.boolean(),
  account_type: z.enum(["claudeai", "console"]),
});
export type RemoteClaudeAccount = z.infer<typeof RemoteClaudeAccount>;

/**
 * Where an interactive Claude sign-in has got to. The browser opens on the
 * host, so a remote client can only follow along — and can only finish at all
 * over the paste-a-code path, which is what `needs_code` says is available.
 */
export const RemoteClaudeLoginState = z.object({
  /** A `claude auth login` child is alive and unfinished. */
  pending: z.boolean(),
  needs_code: z.boolean(),
  /** Set once the attempt is over: how it ended. */
  ok: z.boolean().optional(),
  error: z.string().optional(),
});
export type RemoteClaudeLoginState = z.infer<typeof RemoteClaudeLoginState>;

/**
 * Everything needed to edit one automation. The list shape stays deliberately
 * small; this is only fetched for the automation actually being opened.
 */
export const RemoteAutomationDetail = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  enabled: z.boolean(),
  trigger_kind: z.enum(["manual", "once", "schedule"]),
  cron: z.string().nullable(),
  /** Local `YYYY-MM-DDTHH:mm` — only for `once`. Missing from older hosts. */
  run_at: z.string().nullable().optional(),
  timezone: z.string().nullable(),
  catch_up: z.boolean(),
  /** Full repo paths — an editor has to write them back unchanged. */
  repo_roots: z.array(z.string()),
  source_ids: z.array(z.string()),
  playbook: z.string(),
  /** The user's additions, appended after the playbook on every run. */
  extra_instructions: z.string(),
  autonomy: z.enum(["auto_merge", "draft", "pr", "propose"]).nullable(),
  model: z.string().nullable(),
  /** Runner the run's agent is pinned to; null follows the app default. */
  runner: z.string().nullable(),
  /** Optional so a phone still reads a host from before accounts could be pinned. */
  claude_account_id: z.string().nullable().optional(),
  guardrails: RemoteAutomationGuardrails,
});
export type RemoteAutomationDetail = z.infer<typeof RemoteAutomationDetail>;

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
  /** Opened or dismissed — a failed run read this way leaves the inbox.
   *  Optional so an older host's runs still parse. */
  report_read: z.boolean().optional(),
  /** First line of the report, truncated; null without one. Absent from older hosts. */
  report_preview: z.string().nullable().optional(),
  /** The run's own session, so a client can open the agent that did the work. */
  host_session_id: z.string().nullable(),
  host_agent_id: z.string().nullable(),
});
export type RemoteAutomationRun = z.infer<typeof RemoteAutomationRun>;

/** A note the user left on a run's report, and what it was allowed to do. */
export const RemoteRunFeedback = z.object({
  id: z.string(),
  /** The user's words, verbatim. */
  note: z.string(),
  /** The turn could withdraw or supersede proposals while answering this. */
  allow_clearing: z.boolean(),
  created_at: z.number(),
});
export type RemoteRunFeedback = z.infer<typeof RemoteRunFeedback>;

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
  /** The user did what it asked, outside Argus. Agreement, not rejection. */
  "resolved",
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
  /** The run that raised it, for its report and feedback. */
  run_id: z.string().optional(),
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
  /** The work item it came from, e.g. `acme/app#412`, and where it lives. */
  source_label: z.string().nullable(),
  source_url: z.string().nullable(),
  /** Set once it has been started — the session doing the work. */
  session_id: z.string().nullable(),
  /** The agent working it, once it is running. */
  agent_id: z.string().nullable(),
  /** Non-null only while a start is in flight. */
  start_stage: z
    .enum(["creating_worktree", "setting_up", "starting_agent"])
    .nullable(),
  /** Why the last start failed, readable. Cleared when a start begins. */
  start_error: z.string().nullable(),
  created_at: z.number(),
  /** The record behind a decision, for the proposal's own screen. Optional so
   *  an older host's proposals still parse. */
  accepted_note: z.string().nullable().optional(),
  dismissed_reason: z.string().nullable().optional(),
  resolved_note: z.string().nullable().optional(),
  revision_request: z.string().nullable().optional(),
  cleared_reason: z.string().nullable().optional(),
  /** When a later run superseded or withdrew it; the inbox lists it for a day. */
  cleared_at: z.number().nullable().optional(),
  superseded_by: z.string().nullable().optional(),
});
export type RemoteProposal = z.infer<typeof RemoteProposal>;
