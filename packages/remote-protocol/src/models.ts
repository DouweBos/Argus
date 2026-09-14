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
  kind: z.enum(["org_host", "project_root", "worktree"]),
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
