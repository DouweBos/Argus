import { z } from "zod";
import {
  AgentInfo,
  AgentNotificationInput,
  ChatHistoryEntry,
  ChatHistorySearchResult,
  Checkpoint,
  ImageAttachment,
  QueuedImage,
  QueuedMessage,
  SavedConversation,
  StartOptions,
} from "../models/agents";
import { AgentForkPoint, AgentTranscriptPage } from "../models/conversation";
import { ForkChatResult } from "../models/sessions";
import { LimitHandoffAccount } from "../models/usage";
import { type CommandSpec, NoParams, Void } from "./spec";

const AgentId = z.object({ agentId: z.string() });
const SessionId = z.object({ sessionId: z.string() });
const CheckpointRef = SessionId.extend({ checkpointId: z.string() });
const RepoRoot = z.object({ repoRoot: z.string() });
const HistoryRef = RepoRoot.extend({ historyId: z.string() });
const QueuedRef = AgentId.extend({ id: z.string() });

export const AGENT_COMMANDS = {
  /** The installed Claude CLI's version string. */
  check_claude_cli: { tier: "admin", params: NoParams, result: z.string() },
  /** A fresh start, announced as `agent:started` so every client picks it up. */
  start_agent: {
    tier: "admin",
    params: SessionId.extend({
      model: z.string().optional(),
      permissionMode: z.string().optional(),
      resumeSessionId: z.string().optional(),
      appendSystemPrompt: z.string().optional(),
      /** Client-minted id, so an optimistic entry can land before the spawn. */
      agentId: z.string().optional(),
      runnerId: z.string().optional(),
      /** A fork: start from this agent's history up to and including the message. */
      seedFrom: z
        .object({ agentId: z.string(), throughMessageId: z.string() })
        .optional(),
    }),
    result: AgentInfo,
  },
  stop_agent: { tier: "admin", params: AgentId, result: Void },
  /**
   * Restore an agent's conversation in place — kills and respawns the child
   * under the same id. Null session id for a fresh start at turn 0.
   */
  restore_agent_at_turn: {
    tier: "admin",
    params: AgentId.extend({
      sourceClaudeSessionId: z.string(),
      keepTurnNumber: z.number(),
      cutoffTimestampMs: z.number(),
    }),
    result: ForkChatResult,
  },
  interrupt_agent: { tier: "admin", params: AgentId, result: Void },
  send_agent_message: {
    tier: "admin",
    params: AgentId.extend({
      message: z.string(),
      images: z.array(ImageAttachment).nullish(),
    }),
    result: Void,
  },
  list_agents: { tier: "admin", params: SessionId, result: z.array(AgentInfo) },
  respond_to_permission: {
    tier: "admin",
    params: AgentId.extend({
      toolUseId: z.string(),
      decision: z.enum(["allow", "deny"]),
      allowRule: z.string().nullish(),
      allowAll: z.boolean().nullish(),
      denyMessage: z.string().nullish(),
    }),
    result: Void,
  },
  set_agent_model: {
    tier: "admin",
    params: AgentId.extend({ model: z.string() }),
    result: Void,
  },
  set_agent_permission_mode: {
    tier: "admin",
    params: AgentId.extend({ mode: z.string() }),
    result: Void,
  },
  /** `null` falls back to the model's default effort. */
  set_agent_effort: {
    tier: "admin",
    params: AgentId.extend({ level: z.string().nullish() }),
    result: Void,
  },
  /**
   * The session this window is looking at, null for none, so the host keeps a
   * warm agent there. `viewerId` names the window; `runnerId` is its start
   * composer's runner pick.
   */
  set_viewing_session: {
    tier: "monitor",
    params: z.object({
      sessionId: z.string().nullable(),
      viewerId: z.string().optional(),
      runnerId: z.string().nullish(),
    }),
    result: Void,
  },
  /**
   * Slash commands and models for a start composer: the session's warm agent's
   * when it has one, else the last ones that runner reported.
   */
  get_start_options: {
    tier: "monitor",
    params: SessionId.extend({ runnerId: z.string().nullish() }),
    result: StartOptions,
  },
  /** Spawn a hidden agent ahead of need, so the next start skips the handshake. */
  prewarm_agent: { tier: "admin", params: SessionId, result: AgentInfo },
  claim_prewarm_agent: {
    tier: "admin",
    params: AgentId.extend({
      model: z.string().optional(),
      permissionMode: z.string().optional(),
    }),
    result: AgentInfo,
  },
  discard_prewarm_agent: { tier: "admin", params: AgentId, result: Void },
  /** Snapshot the session worktree before a prompt, to restore it later. */
  create_checkpoint: { tier: "admin", params: SessionId, result: Checkpoint },
  restore_checkpoint: { tier: "admin", params: CheckpointRef, result: Void },
  delete_checkpoint: { tier: "admin", params: CheckpointRef, result: Void },
  save_chat_history: {
    tier: "admin",
    params: RepoRoot.extend({ conversation: SavedConversation }),
    result: Void,
  },
  list_chat_history: {
    tier: "admin",
    params: RepoRoot,
    result: z.array(ChatHistoryEntry),
  },
  search_chat_history: {
    tier: "admin",
    params: RepoRoot.extend({ query: z.string() }),
    result: z.array(ChatHistorySearchResult),
  },
  load_chat_history: {
    tier: "admin",
    params: HistoryRef,
    result: SavedConversation.nullable(),
  },
  delete_chat_history: { tier: "admin", params: HistoryRef, result: Void },
  /** Pull chats run with the plain Claude Code CLI into every project's history now. */
  import_cli_chats: {
    tier: "admin",
    params: NoParams,
    result: z.object({ imported: z.number(), projects: z.number() }),
  },
  /** A short title for a chat from its first message; null on any failure. */
  generate_session_title: {
    tier: "admin",
    params: z.object({ firstMessage: z.string() }),
    result: z.string().nullable(),
  },
  /** Unix ms a "continue" is scheduled for after a usage limit; null if none. */
  get_agent_limit_resume: {
    tier: "admin",
    params: AgentId,
    result: z.number().nullable(),
  },
  /** Drop the pending continue and hold off until a turn gets through. */
  dismiss_agent_limit_resume: { tier: "admin", params: AgentId, result: Void },
  /** Other accounts a limit-stalled agent can move to; empty when it isn't stalled. */
  get_agent_limit_handoff: {
    tier: "admin",
    params: AgentId,
    result: z.array(LimitHandoffAccount),
  },
  /** Move a limit-stalled agent onto another account and continue its turn. */
  handoff_agent_to_account: {
    tier: "admin",
    params: AgentId.extend({ accountId: z.string() }),
    result: Void,
  },
  list_queued_messages: {
    tier: "admin",
    params: AgentId,
    result: z.array(QueuedMessage),
  },
  queue_message: {
    tier: "admin",
    params: AgentId.extend({
      text: z.string(),
      displayText: z.string().optional(),
      images: z.array(QueuedImage).optional(),
      author: z.string().optional(),
    }),
    result: QueuedMessage,
  },
  remove_queued_message: { tier: "admin", params: QueuedRef, result: Void },
  update_queued_message: {
    tier: "admin",
    params: QueuedRef.extend({ text: z.string() }),
    result: Void,
  },
  /** Send one queued message ahead of the rest, into a busy agent's turn. */
  send_queued_message_now: {
    tier: "admin",
    params: QueuedRef,
    result: z.object({ mid_turn: z.boolean() }),
  },
  clear_queued_messages: { tier: "admin", params: AgentId, result: Void },
  dequeue_message: {
    tier: "admin",
    params: AgentId,
    result: QueuedMessage.nullable(),
  },
  /**
   * A page of the conversation the host folds for an agent: the newest, or the
   * one ending at `before`. Follow it with `agent:transcript:<agentId>` deltas.
   */
  get_agent_transcript: {
    tier: "admin",
    params: AgentId.extend({
      before: z.number().int().nonnegative().optional(),
      limit: z.number().int().positive().max(500).optional(),
    }),
    result: AgentTranscriptPage.nullable(),
  },
  /**
   * Send a message, or queue it behind the turn in flight. A sent message gets
   * a worktree checkpoint and its bubble in the transcript.
   */
  submit_agent_message: {
    tier: "admin",
    params: AgentId.extend({
      text: z.string(),
      displayText: z.string().optional(),
      images: z.array(ImageAttachment).optional(),
      author: z.string().optional(),
    }),
    result: z.object({ queued: z.boolean() }),
  },
  /**
   * Rewind to just before a user message: cut the transcript, respawn the CLI
   * on a transcript forked at that turn, drop the queue. `resend` sends an
   * edited message in its place; `restoreFiles` also restores its checkpoint.
   */
  rewind_agent: {
    tier: "admin",
    params: AgentId.extend({
      messageId: z.string(),
      resend: z
        .object({
          text: z.string(),
          images: z.array(ImageAttachment).optional(),
        })
        .optional(),
      restoreFiles: z.boolean().optional(),
    }),
    result: z.object({
      claude_session_id: z.string().nullable(),
      /** The rewound message's text, to put back in the composer. */
      restoredPrompt: z.string(),
    }),
  },
  /** What forking at a message needs from the whole history. */
  agent_fork_point: {
    tier: "admin",
    params: AgentId.extend({ messageId: z.string() }),
    result: AgentForkPoint,
  },
  set_agent_title: {
    tier: "admin",
    params: AgentId.extend({ title: z.string() }),
    result: Void,
  },
  /** Hide the todo or task list until the agent writes a new one. */
  dismiss_agent_list: {
    tier: "admin",
    params: AgentId.extend({ list: z.enum(["tasks", "todos"]) }),
    result: Void,
  },
  /** Empty the transcript; the CLI keeps its context. */
  clear_agent_transcript: { tier: "admin", params: AgentId, result: Void },
  /**
   * Older desktops published the conversations they folded. Accepted and
   * ignored: the host folds every conversation itself.
   */
  publish_agent_snapshot: {
    tier: "admin",
    params: AgentId.extend({ snapshot: z.string().nullish() }),
    result: Void,
  },
  /** The conversation as one JSON document, for desktops older than `get_agent_transcript`. */
  get_agent_snapshot: {
    tier: "admin",
    params: AgentId,
    result: z.string().nullable(),
  },
  /**
   * The client decides what a notification says; the host shows it (only there
   * can quick-action buttons render) and fans it out to paired devices.
   */
  notify_agent: {
    tier: "admin",
    params: z.object({
      payload: AgentNotificationInput,
      showLocal: z.boolean(),
    }),
    result: Void,
  },
} as const satisfies Record<string, CommandSpec>;
