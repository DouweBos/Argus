/**
 * Wire types the client speaks — a focused mirror of `@argus/remote-protocol`.
 * Kept as plain TS (no zod runtime needed on the client hot path) but matching
 * the desktop schemas exactly.
 */

export interface PairingPayload {
  v: 1;
  url: string; // public wss:// (Cloudflare tunnel)
  ds_pub: string; // base64url
  pairing_secret: string; // base64url
}

export interface PairingGrant {
  device_id: string;
  capabilities: string[];
  /** The computer's name — labels it in the phone's paired-computer list. */
  host_name?: string;
}

export type RemoteMethod =
  | "host.endpoints"
  | "projects.list"
  | "sessions.list"
  | "agents.list"
  | "agents.status"
  | "agents.vitals"
  | "agents.transcript"
  | "agents.image"
  | "agents.stopped"
  | "agents.stopped_transcript"
  | "agents.stopped_image"
  | "orgs.list"
  | "permission.respond"
  | "device.rename"
  | "device.capabilities"
  | "device.push_info"
  | "device.register_push"
  | "device.unregister_push"
  | "agents.capabilities"
  | "agents.send"
  | "agents.interrupt"
  | "agents.stop"
  | "agents.set_model"
  | "agents.set_permission_mode"
  | "agents.set_effort"
  | "agents.spawn"
  | "agents.queue_list"
  | "agents.queue_add"
  | "agents.queue_remove"
  | "agents.queue_update"
  | "sessions.create"
  | "sessions.delete"
  | "sessions.rename"
  | "sessions.rename_branch"
  | "sessions.files"
  | "sessions.resolve_mention_path"
  | "sessions.git_status"
  | "sessions.branches"
  | "sessions.checkout"
  | "sessions.create_branch"
  | "sessions.delete_branch"
  | "sessions.diff"
  | "devices.list"
  | "devices.watch"
  | "devices.unwatch"
  | "devices.touch"
  | "devices.button"
  | "devices.keyboard"
  | "automations.list"
  | "automations.runs"
  | "automations.run"
  | "automations.run_now"
  | "automations.cancel_run"
  | "automations.mark_run_read"
  | "proposals.list"
  | "proposals.accept"
  | "proposals.dismiss"
  | "proposals.perform_cleanup";

export type RemotePlatform = "ios" | "android";

export interface RemoteDevice {
  id: string;
  platform: RemotePlatform;
  name: string;
  runtime?: string | null;
  booted: boolean;
  /** TV form factor (Apple TV / Android TV) — driven by the dpad, not touch. */
  is_tv: boolean;
  capturing: boolean;
  width?: number;
  height?: number;
}

export type RemotePermissionMode =
  | "ask"
  | "auto"
  | "plan"
  | "review"
  | "trusted";

export interface RemoteModelInfo {
  value: string;
  displayName: string;
  description: string;
  supportsEffort?: boolean;
  supportedEffortLevels?: string[];
  supportsFastMode?: boolean;
}
export interface RemoteSlashCommand {
  name: string;
  description: string;
  argumentHint: string;
}
export interface RemoteSubagentType {
  name: string;
  description: string;
  model?: string;
}
export interface RemoteAgentCapabilities {
  models: RemoteModelInfo[];
  commands: RemoteSlashCommand[];
  agents: RemoteSubagentType[];
}
export interface RemoteMentionEntry {
  name: string;
  is_dir: boolean;
}
export interface RemoteMentionPathResult {
  entries: RemoteMentionEntry[];
  resolved_path: string;
}
export interface RemoteImageAttachment {
  data: string;
  media_type: string;
}

export interface RemoteGitInProgress {
  kind: "bisect" | "cherry-pick" | "merge" | "rebase";
  head: string;
  onto?: string;
}
export interface RemoteGitStatus {
  branch: string;
  upstream: string | null;
  ahead: number;
  behind: number;
  dirty_count: number;
  stash_count: number;
  conflict_count: number;
  detached: boolean;
  last_fetch_at: number | null;
  in_progress: RemoteGitInProgress | null;
  diff_additions?: number;
  diff_deletions?: number;
}

/** A branch the switcher can offer; `name` is always the checkout target. */
export interface RemoteGitBranch {
  name: string;
  scope: "local" | "remote";
  remote?: string;
  is_current: boolean;
  upstream?: string | null;
  ahead: number;
  behind: number;
  last_commit_subject?: string;
  last_commit_at?: number;
}

export interface RemoteProject {
  repo_root: string;
  name: string;
}
export interface RemoteSession {
  id: string;
  repo_root: string;
  kind: string;
  branch: string;
  display_name?: string | null;
  status: string;
}
export interface RemoteAgentStatus {
  agent_id: string;
  session_id: string;
  session_label?: string;
  project_name?: string;
  title?: string | null;
  status: string;
  model?: string | null;
  permission_mode?: string | null;
  parent_agent_id?: string | null;
  created_at?: number;
  last_activity_at?: number;
  /** What the agent is blocked on the user for, if anything. */
  awaiting?: "permission" | "question" | "plan" | null;
}

/**
 * A finished agent conversation, read back from the computer's saved chat
 * history. Addressed by `history_id` — the agent process itself is gone.
 */
export interface RemoteStoppedAgent {
  history_id: string;
  runner_session_id: string;
  title: string;
  branch: string;
  description?: string;
  model?: string | null;
  message_count: number;
  started_at: number;
  ended_at: number;
}

/**
 * A message waiting for a busy agent's turn to end. The queue lives on the
 * computer, so it survives reinstalling this app and is shared with the
 * desktop — which is also what drains it.
 */
export interface RemoteQueuedMessage {
  id: string;
  text: string;
  display_text?: string;
  /** Who queued it, when a huddle guest rather than the host did. */
  author?: string;
  images?: RemoteImageAttachment[];
  queued_at: number;
}

export interface RemoteImageRef {
  image_id: string;
  media_type: string;
}

export type RemoteToolResultBlock =
  | { type: "text"; text: string }
  | { type: "image"; image_id: string; media_type: string };

export type RemoteToolCallChild =
  | { kind: "text"; text: string }
  | { kind: "tool_use"; tool_call: RemoteToolCall };

export interface RemoteToolCall {
  id: string;
  name: string;
  input: Record<string, unknown>;
  result_blocks: RemoteToolResultBlock[];
  children?: RemoteToolCallChild[];
  pending_permission?: boolean;
  is_error?: boolean;
  status: "done" | "error" | "pending" | "running";
}

export interface RemoteMessageSource {
  kind: "mcp";
  tool: string;
  parent_agent_id?: string | null;
  parent_label?: string | null;
}

export interface RemoteTokenUsage {
  input_tokens: number;
  output_tokens: number;
  cache_read_input_tokens?: number;
  cache_creation_input_tokens?: number;
}

export interface RemoteMessage {
  id: string;
  role: "assistant" | "system" | "user";
  text_blocks: string[];
  tool_calls: RemoteToolCall[];
  images?: RemoteImageRef[];
  source?: RemoteMessageSource;
  /** Who sent a user message, when a huddle guest rather than the host did. */
  author?: string;
  is_error?: boolean;
  timestamp?: number;
  usage?: RemoteTokenUsage;
}

export interface RemoteTask {
  id: string;
  subject: string;
  status: "completed" | "in_progress" | "pending";
  description?: string;
  activeForm?: string;
  owner?: string;
  blocks?: string[];
  blockedBy?: string[];
}

export interface RemoteTodo {
  content: string;
  status: "completed" | "in_progress" | "pending";
  activeForm?: string;
}

export interface RemoteTranscript {
  messages: RemoteMessage[];
  next_after: number | null;
  prev_before?: number | null;
  total?: number;
  tasks?: RemoteTask[] | null;
  todos?: RemoteTodo[] | null;
  model?: string | null;
  pending_tool_name?: string | null;
}

export interface RemoteImageData {
  data: string;
  media_type: string;
}
export interface RemotePermissionRequest {
  agent_id: string;
  tool_use_id: string;
  tool_name: string;
  tool_input: Record<string, unknown>;
}
/** A quick-action button on a notification, chosen by the desktop. */
export interface RemoteNotificationAction {
  id: "approve" | "deny";
  title: string;
}

export interface RemoteNotification {
  agent_id: string | null;
  session_id: string | null;
  /** The prompt an action answers; only set for `kind: "permission"`. */
  tool_use_id: string | null;
  kind: "failed" | "finished" | "permission" | "push";
  title: string;
  body: string;
  actions: RemoteNotificationAction[];
}

// Envelopes -----------------------------------------------------------------

export interface RequestEnvelope {
  type: "req";
  seq: number;
  id: string;
  method: RemoteMethod;
  params: unknown;
}
export interface ResponseEnvelope {
  type: "res";
  seq: number;
  id: string;
  ok?: unknown;
  error?: { code: string; message: string };
}
export interface SubscribeEnvelope {
  type: "sub";
  seq: number;
  action: "subscribe" | "unsubscribe";
  agent_id: string;
}
export interface EventEnvelope {
  type: "evt";
  seq: number;
  event: string;
  agent_id?: string | null;
  payload: unknown;
}
export type Envelope =
  | RequestEnvelope
  | ResponseEnvelope
  | SubscribeEnvelope
  | EventEnvelope;

// --- Automations -----------------------------------------------------------

export type RemoteAutonomy = "auto_merge" | "draft" | "pr" | "propose";

/**
 * An automation as this client needs it: enough to show what it is and when it
 * next fires, never enough to edit it. Editing a playbook is a desktop job.
 */
export interface RemoteAutomation {
  id: string;
  name: string;
  description: string;
  enabled: boolean;
  trigger_kind: "manual" | "schedule";
  /** 5-field cron and its IANA zone — only for `schedule`. */
  cron: string | null;
  timezone: string | null;
  /** Null means it inherits the computer's default rung. */
  autonomy: RemoteAutonomy | null;
  /** Project names, not paths — a path means nothing on a phone. */
  projects: string[];
  last_run_at: number | null;
  next_run_at: number | null;
  running: boolean;
}

export type RemoteAutomationRunStatus =
  | "cancelled"
  | "failed"
  | "queued"
  | "running"
  | "skipped"
  | "succeeded";

/** One firing. `automation_name` is resolved by the computer, quick runs too. */
export interface RemoteAutomationRun {
  id: string;
  automation_id: string;
  automation_name: string;
  is_quick: boolean;
  status: RemoteAutomationRunStatus;
  trigger_reason: string;
  started_at: number;
  finished_at: number | null;
  cost_usd: number | null;
  error: string | null;
  /** It wrote a report, nobody has read it, and nothing newer has replaced it. */
  unread_report: boolean;
  host_session_id: string | null;
  host_agent_id: string | null;
}

export type RemoteReportTone = "critical" | "info" | "positive" | "warning";

/**
 * Structured report blocks, mirroring `@argus/remote-protocol`'s closed union.
 * The computer validates them, so anything that arrives here is well-formed.
 */
export type RemoteReportBlock =
  | { type: "heading"; text: string }
  | { type: "markdown"; text: string }
  | {
      type: "stats";
      items: { label: string; value: string; delta?: number }[];
    }
  | { type: "table"; columns: string[]; rows: (number | string)[][] }
  | {
      type: "list";
      items: { text: string; href?: string; tone?: RemoteReportTone }[];
    }
  | {
      type: "series";
      kind: "bar" | "line";
      labels: string[];
      values: number[];
      label?: string;
    }
  | { type: "proposals"; ids: string[] }
  | { type: "sessions"; ids: string[] };

export interface RemoteAutomationRunDetail {
  run: RemoteAutomationRun;
  report_blocks: RemoteReportBlock[] | null;
  report_markdown: string | null;
}

/**
 * What a proposal's one button does. `start_session` spins up a worktree; the
 * two `delete_` kinds run a cleanup on the computer, behind a confirm.
 */
export interface RemoteProposalCta {
  kind: "delete_branch" | "delete_session" | "open_url" | "start_session";
  label: string;
  url: string | null;
  branch: string | null;
  force: boolean;
  session_id: string | null;
}

/** One thing an automation wants you to decide on. Names resolved by the computer. */
export interface RemoteProposal {
  id: string;
  automation_id: string;
  automation_name: string;
  title: string;
  summary: string;
  rationale: string;
  /** 0..1, self-reported by the run's agent. */
  confidence: number;
  cta: RemoteProposalCta | null;
  status:
    | "accepted"
    | "auto_started"
    | "dismissed"
    | "pending"
    | "superseded"
    | "withdrawn";
  /** Project name, never a path. */
  project: string | null;
  source_label: string | null;
  source_url: string | null;
  session_id: string | null;
  created_at: number;
}
