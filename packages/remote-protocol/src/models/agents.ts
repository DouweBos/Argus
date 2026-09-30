import { z } from "zod";

/** Lifecycle state of an agent process. */
export const AgentStatusValue = z.enum([
  "error",
  "idle",
  "requires_action",
  "running",
  "stopped",
]);
export type AgentStatusValue = z.infer<typeof AgentStatusValue>;

export const AgentSlashCommand = z.object({
  /** Hint for arguments (e.g. "<file>", ""). */
  argumentHint: z.string(),
  /** Description of what the command does. */
  description: z.string(),
  /** Command name without leading slash. */
  name: z.string(),
});
export type AgentSlashCommand = z.infer<typeof AgentSlashCommand>;

export const AgentModelInfo = z.object({
  description: z.string(),
  displayName: z.string(),
  supportedEffortLevels: z.array(z.string()).optional(),
  supportsEffort: z.boolean().optional(),
  supportsFastMode: z.boolean().optional(),
  value: z.string(),
});
export type AgentModelInfo = z.infer<typeof AgentModelInfo>;

/** A subagent type the CLI can dispatch to. */
export const AgentSubagentInfo = z.object({
  description: z.string(),
  model: z.string().optional(),
  name: z.string(),
});
export type AgentSubagentInfo = z.infer<typeof AgentSubagentInfo>;

export const AgentAccountInfo = z.object({
  apiProvider: z.string().optional(),
  email: z.string().optional(),
  organization: z.string().optional(),
  subscriptionType: z.string().optional(),
});
export type AgentAccountInfo = z.infer<typeof AgentAccountInfo>;

/** What the CLI reports in its initialize handshake. */
export const AgentCapabilities = z.object({
  account: AgentAccountInfo,
  agents: z.array(AgentSubagentInfo),
  available_output_styles: z.array(z.string()),
  commands: z.array(AgentSlashCommand),
  models: z.array(AgentModelInfo),
  output_style: z.string(),
});
export type AgentCapabilities = z.infer<typeof AgentCapabilities>;

/** A live agent, as the host reports it. */
export const AgentInfo = z.object({
  agent_id: z.string(),
  /**
   * Initialize-response capabilities captured during the CLI handshake.
   * Returned inline so the client has them immediately on `start_agent` — the
   * async `agent:capabilities` event can fire before listeners are wired up.
   */
  capabilities: AgentCapabilities.nullish(),
  /** Unix ms timestamp when the agent session was created. */
  created_at: z.number(),
  /**
   * Model id the agent is running with (variant suffixes like `[1m]` preserved),
   * or null if the CLI default was used.
   */
  model: z.string().nullable(),
  /** Agent that spawned this one (null for user-initiated agents). */
  parent_agent_id: z.string().nullable(),
  /**
   * Runner this agent is bound to. Inherited from the session at spawn, then
   * switchable per agent until its first prompt.
   */
  runner_id: z.string(),
  session_id: z.string(),
  status: AgentStatusValue,
});
export type AgentInfo = z.infer<typeof AgentInfo>;

/** An image sent with a prompt. */
export const ImageAttachment = z.object({
  /** Base64-encoded image data (no data-URL prefix). */
  data: z.string(),
  /** MIME type, e.g. "image/png", "image/jpeg". */
  media_type: z.string(),
});
export type ImageAttachment = z.infer<typeof ImageAttachment>;

/** An image attached to a queued message, as the host stores it. */
export const QueuedImage = ImageAttachment;
export type QueuedImage = ImageAttachment;

/** A message waiting for an agent's current turn to end. */
export const QueuedMessage = z.object({
  /** Who queued it, when a huddle guest rather than the engineer did. */
  author: z.string().optional(),
  /** What the clients show, when it differs from `text`. */
  display_text: z.string().optional(),
  id: z.string(),
  images: z.array(QueuedImage).optional(),
  queued_at: z.number(),
  /** What gets sent to the agent — may carry a preamble the user never typed. */
  text: z.string(),
});
export type QueuedMessage = z.infer<typeof QueuedMessage>;

/** A snapshot of a session worktree, restorable from a chat message. */
export const Checkpoint = z.object({
  createdAt: z.number(),
  /** True when there were uncommitted changes at snapshot time. */
  hasChanges: z.boolean(),
  id: z.string(),
  /** Commit SHA of the snapshot (stash-style commit, or HEAD when clean). */
  sha: z.string(),
});
export type Checkpoint = z.infer<typeof Checkpoint>;

/** Lightweight summary stored in the history index — enough for list rendering. */
export const ChatHistoryEntry = z.object({
  /** Agent that produced this conversation — absent on older records. */
  agentId: z.string().optional(),
  /** Argus session the agent ran in — absent on older records. */
  argusSessionId: z.string().optional(),
  createdAt: z.number(),
  endedAt: z.number(),
  id: z.string(),
  messageCount: z.number(),
  model: z.string().optional(),
  /** Agent that spawned this one — absent on older records. */
  parentAgentId: z.string().optional(),
  /**
   * Runner that produced the conversation — absent on older records. Resuming
   * re-binds the new agent to it.
   */
  runnerId: z.string().optional(),
  sessionBranch: z.string(),
  sessionDescription: z.string(),
  sessionId: z.string(),
  title: z.string(),
  totalCost: z.number().optional(),
  totalDuration: z.number().optional(),
});
export type ChatHistoryEntry = z.infer<typeof ChatHistoryEntry>;

/** Full saved conversation (entry metadata + messages the client serialised). */
export const SavedConversation = ChatHistoryEntry.extend({
  messages: z.array(z.unknown()),
});
export type SavedConversation = z.infer<typeof SavedConversation>;

/** A single snippet from a message that matched a search query. */
export const ChatHistoryMessageMatch = z.object({
  /** Index of the match end (exclusive) within `snippet`. */
  matchEnd: z.number(),
  /** Index of the match start within `snippet`. */
  matchStart: z.number(),
  /** Position of the message in the conversation. */
  messageIndex: z.number(),
  role: z.enum(["assistant", "system", "user"]),
  /** A short excerpt of the message text around the first match. */
  snippet: z.string(),
});
export type ChatHistoryMessageMatch = z.infer<typeof ChatHistoryMessageMatch>;

export const ChatHistorySearchResult = z.object({
  entry: ChatHistoryEntry,
  /** Matches inside message text blocks (capped per entry). */
  messageMatches: z.array(ChatHistoryMessageMatch),
  /** True when the query matches title / branch / model / description. */
  metaMatch: z.boolean(),
});
export type ChatHistorySearchResult = z.infer<typeof ChatHistorySearchResult>;

/** What a client says an agent notification is; the host derives its actions. */
export const AgentNotificationInput = z.object({
  agent_id: z.string().nullable(),
  body: z.string(),
  kind: z.enum(["failed", "finished", "permission", "push"]),
  session_id: z.string().nullable(),
  title: z.string(),
  /** The tool being requested — decides which quick actions make sense. */
  tool_name: z.string().nullable(),
  /** The prompt to answer. Only meaningful for `kind: "permission"`. */
  tool_use_id: z.string().nullable(),
});
export type AgentNotificationInput = z.infer<typeof AgentNotificationInput>;
