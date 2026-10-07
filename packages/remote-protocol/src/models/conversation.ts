/**
 * An agent's conversation as the host folds it: the desktop-side shape, with
 * inline image bytes, that desktop viewers page through and patch with
 * deltas. Phones get the narrower `RemoteMessage` mirror instead.
 */

import { z } from "zod";
import {
  AgentCapabilities,
  AgentSlashCommand,
  ImageAttachment,
} from "./agents";

export const ConversationTokenUsage = z.object({
  cache_creation_input_tokens: z.number().optional(),
  cache_read_input_tokens: z.number().optional(),
  input_tokens: z.number(),
  output_tokens: z.number(),
});
export type ConversationTokenUsage = z.infer<typeof ConversationTokenUsage>;

export const ConversationToolResultBlock = z.union([
  z.object({
    source: z.object({
      data: z.string(),
      media_type: z.string(),
      type: z.literal("base64"),
    }),
    type: z.literal("image"),
  }),
  z.object({ text: z.string(), type: z.literal("text") }),
]);
export type ConversationToolResultBlock = z.infer<
  typeof ConversationToolResultBlock
>;

export interface ConversationToolCall {
  /** What a Task/Agent call's subagent streamed. */
  children?: ConversationToolCallChild[];
  id: string;
  input: Record<string, unknown>;
  isError?: boolean;
  name: string;
  pendingPermission?: boolean;
  result?: ConversationToolResultBlock[] | string;
}

export type ConversationToolCallChild =
  | { kind: "text"; text: string }
  | { kind: "tool_use"; toolCall: ConversationToolCall };

export const ConversationToolCall: z.ZodType<ConversationToolCall> = z.lazy(
  () =>
    z.object({
      children: z.array(ConversationToolCallChild).optional(),
      id: z.string(),
      input: z.record(z.string(), z.unknown()),
      isError: z.boolean().optional(),
      name: z.string(),
      pendingPermission: z.boolean().optional(),
      result: z
        .union([z.array(ConversationToolResultBlock), z.string()])
        .optional(),
    }),
);

export const ConversationToolCallChild: z.ZodType<ConversationToolCallChild> =
  z.lazy(() =>
    z.union([
      z.object({ kind: z.literal("text"), text: z.string() }),
      z.object({ kind: z.literal("tool_use"), toolCall: ConversationToolCall }),
    ]),
  );

export const ConversationMessageSource = z.object({
  kind: z.literal("mcp"),
  parentAgentId: z.string().optional(),
  parentLabel: z.string().optional(),
  tool: z.enum([
    "create_session",
    "send_agent_message",
    "spawn_agent",
    "spawn_agents_batch",
  ]),
});
export type ConversationMessageSource = z.infer<
  typeof ConversationMessageSource
>;

export const ConversationMessage = z.object({
  author: z.string().optional(),
  checkpointId: z.string().optional(),
  id: z.string(),
  images: z.array(ImageAttachment).optional(),
  role: z.enum(["assistant", "system", "user"]),
  source: ConversationMessageSource.optional(),
  textBlocks: z.array(z.string()),
  timestamp: z.number(),
  tone: z.enum(["error", "warning"]).optional(),
  toolCalls: z.array(ConversationToolCall),
  usage: ConversationTokenUsage.optional(),
});
export type ConversationMessage = z.infer<typeof ConversationMessage>;

const ItemStatus = z.enum(["completed", "in_progress", "pending"]);

export const ConversationTodo = z.object({
  activeForm: z.string().optional(),
  content: z.string(),
  status: ItemStatus,
});
export type ConversationTodo = z.infer<typeof ConversationTodo>;

export const ConversationTask = z.object({
  activeForm: z.string().optional(),
  blockedBy: z.array(z.string()).optional(),
  blocks: z.array(z.string()).optional(),
  description: z.string().optional(),
  id: z.string(),
  metadata: z.record(z.string(), z.unknown()).optional(),
  owner: z.string().optional(),
  status: ItemStatus,
  subject: z.string(),
});
export type ConversationTask = z.infer<typeof ConversationTask>;

/** Everything about a conversation except its messages. */
export const AgentConversationMeta = z.object({
  capabilities: AgentCapabilities.nullable().optional(),
  contextWindow: z.number().optional(),
  /** The first user message's text, for a title before one is generated. */
  firstUserText: z.string().optional(),
  lastEventType: z.string().optional(),
  model: z.string().optional(),
  pendingToolInput: z.record(z.string(), z.unknown()).nullable().optional(),
  pendingToolName: z.string().nullable().optional(),
  resuming: z.boolean().optional(),
  /** A Task/Agent call anywhere in the history is still working. */
  runningSubagents: z.boolean().optional(),
  sessionId: z.string().optional(),
  slashCommands: z.array(AgentSlashCommand).optional(),
  taskOrder: z.array(z.string()).optional(),
  tasks: z.record(z.string(), ConversationTask).nullable().optional(),
  title: z.string().optional(),
  todos: z.array(ConversationTodo).nullable().optional(),
  tools: z.array(z.string()).optional(),
  totalCost: z.number().optional(),
  totalDuration: z.number().optional(),
});
export type AgentConversationMeta = z.infer<typeof AgentConversationMeta>;

/**
 * A page of the raw history. `start` is the index of `messages[0]`; `epoch`
 * and `revision` line the page up with the deltas that follow it.
 */
export const AgentTranscriptPage = z.object({
  epoch: z.string(),
  messages: z.array(ConversationMessage),
  meta: AgentConversationMeta,
  revision: z.number().int().nonnegative(),
  start: z.number().int().nonnegative(),
  total: z.number().int().nonnegative(),
});
export type AgentTranscriptPage = z.infer<typeof AgentTranscriptPage>;

/** One change to the history, addressed by raw index. */
export const AgentTranscriptOp = z.union([
  z.object({
    index: z.number().int().nonnegative(),
    message: ConversationMessage,
    op: z.enum(["append", "update"]),
  }),
  /** Only ever the last message, after a rewind or a clear. */
  z.object({
    id: z.string(),
    index: z.number().int().nonnegative(),
    op: z.literal("remove"),
  }),
]);
export type AgentTranscriptOp = z.infer<typeof AgentTranscriptOp>;

/**
 * What changed since `revision - 1`, pushed as `agent:transcript:<agentId>`.
 * `meta` holds only the fields that changed; null clears one. A viewer whose
 * revision isn't `revision - 1`, or whose epoch differs, refetches.
 */
export const AgentTranscriptDelta = z.object({
  agentId: z.string(),
  epoch: z.string(),
  meta: z
    .record(z.string(), z.unknown())
    .optional()
    .describe("Changed AgentConversationMeta fields; null clears one."),
  ops: z.array(AgentTranscriptOp),
  revision: z.number().int().positive(),
  total: z.number().int().nonnegative(),
});
export type AgentTranscriptDelta = Omit<
  z.infer<typeof AgentTranscriptDelta>,
  "meta"
> & {
  meta?: {
    [K in keyof AgentConversationMeta]?: AgentConversationMeta[K] | null;
  };
};
