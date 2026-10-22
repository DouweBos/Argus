/**
 * The desktop conversation → `RemoteMessage` mapping behind `agents.transcript`,
 * `agents.image` and the `agent.transcript` event.
 */

import type {
  AgentConversationMeta,
  AgentTranscriptDelta,
  EventPayloads,
  RemoteMessage,
  RemoteTask,
  RemoteTodo,
  RemoteToolCall,
  RemoteToolCallChild,
  RemoteToolResultBlock,
} from "@argus/remote-protocol";
import type { z } from "zod";
import {
  type VisibilityOptions,
  visibleMessages,
} from "../agent/conversation/visibility";

/**
 * The conversation shapes this reads — a folded `AgentConversation`, or one
 * saved by any past version. Deliberately loose: fields we don't forward are
 * omitted.
 */
export type RawResultBlock =
  | {
      type: "image";
      source: { data: string; media_type: string; type: string };
    }
  | { type: "text"; text: string };
export interface RawToolCall {
  id?: string;
  name?: string;
  input?: Record<string, unknown>;
  result?: RawResultBlock[] | string;
  isError?: boolean;
  pendingPermission?: boolean;
  children?: RawChild[];
}
export type RawChild =
  | { kind: "text"; text: string }
  | { kind: "tool_use"; toolCall: RawToolCall };
export interface RawImage {
  data: string;
  media_type: string;
}
export interface RawSource {
  kind?: string;
  tool?: string;
  parentAgentId?: string;
  parentLabel?: string;
}
export interface RawTokenUsage {
  input_tokens?: number;
  output_tokens?: number;
  cache_read_input_tokens?: number;
  cache_creation_input_tokens?: number;
}
export interface RawMessage {
  id?: string;
  author?: string;
  role?: string;
  textBlocks?: string[];
  toolCalls?: RawToolCall[];
  images?: RawImage[];
  source?: RawSource;
  isError?: boolean;
  timestamp?: number;
  usage?: RawTokenUsage;
}
export interface RawTask {
  id?: string;
  subject?: string;
  status?: string;
  description?: string;
  activeForm?: string;
  owner?: string;
  blocks?: string[];
  blockedBy?: string[];
}
export interface RawTodo {
  content?: string;
  status?: string;
  activeForm?: string;
}
export interface RawConversation {
  messages?: RawMessage[];
  tasks?: Record<string, RawTask> | null;
  taskOrder?: string[];
  todos?: RawTodo[] | null;
  followUps?: string[];
  model?: string | null;
  pendingToolName?: string | null;
  title?: string;
}

/**
 * Stable image id for a result/attachment block. `slot` is the owning tool's
 * id, or "msg" for message-level attachments. Ids are recomputed on demand by
 * `agents.image` from the same conversation, so they need no server-side storage.
 */
function imageId(messageId: string, slot: string, blockIndex: number): string {
  return `${messageId}:${slot}:${blockIndex}`;
}

function resultBlocks(
  messageId: string,
  toolUseId: string,
  result: RawToolCall["result"],
): RemoteToolResultBlock[] {
  if (result == null) {
    return [];
  }
  if (typeof result === "string") {
    return result ? [{ type: "text", text: result }] : [];
  }

  return result.map((block, i): RemoteToolResultBlock => {
    if (block.type === "image") {
      return {
        type: "image",
        image_id: imageId(messageId, toolUseId, i),
        media_type: block.source.media_type,
      };
    }
    if (block.type === "text") {
      return { type: "text", text: block.text };
    }

    return { type: "text", text: JSON.stringify(block) };
  });
}

function toolStatus(tc: RawToolCall): RemoteToolCall["status"] {
  if (tc.pendingPermission) {
    return "pending";
  }
  if (tc.isError) {
    return "error";
  }

  return tc.result != null ? "done" : "running";
}

function toRemoteToolCall(messageId: string, tc: RawToolCall): RemoteToolCall {
  const id = tc.id ?? "";
  const status = toolStatus(tc);
  const children = tc.children?.map(
    (c): RemoteToolCallChild =>
      c.kind === "text"
        ? { kind: "text", text: c.text }
        : {
            kind: "tool_use",
            tool_call: toRemoteToolCall(messageId, c.toolCall),
          },
  );

  return {
    id,
    name: tc.name ?? "tool",
    input: tc.input ?? {},
    result_blocks: resultBlocks(messageId, id, tc.result),
    ...(children && children.length > 0 ? { children } : {}),
    ...(tc.pendingPermission ? { pending_permission: true } : {}),
    ...(tc.isError ? { is_error: true } : {}),
    status,
  };
}

export function toRemoteMessage(m: RawMessage): RemoteMessage {
  const messageId = m.id ?? "";
  const role = m.role === "user" || m.role === "system" ? m.role : "assistant";
  const images = (m.images ?? []).map((img, i) => ({
    image_id: imageId(messageId, "msg", i),
    media_type: img.media_type,
  }));
  const source =
    m.source?.kind === "mcp" && m.source.tool
      ? {
          kind: "mcp" as const,
          tool: m.source.tool,
          parent_agent_id: m.source.parentAgentId ?? null,
          parent_label: m.source.parentLabel ?? null,
        }
      : undefined;

  return {
    id: messageId,
    role,
    text_blocks: (m.textBlocks ?? []).filter((t) => t.trim().length > 0),
    tool_calls: (m.toolCalls ?? []).map((tc) =>
      toRemoteToolCall(messageId, tc),
    ),
    ...(images.length > 0 ? { images } : {}),
    ...(source ? { source } : {}),
    ...(m.usage && typeof m.usage.input_tokens === "number"
      ? {
          usage: {
            input_tokens: m.usage.input_tokens,
            output_tokens: m.usage.output_tokens ?? 0,
            cache_read_input_tokens: m.usage.cache_read_input_tokens,
            cache_creation_input_tokens: m.usage.cache_creation_input_tokens,
          },
        }
      : {}),
    ...(m.author ? { author: m.author } : {}),
    is_error: m.isError,
    timestamp: m.timestamp,
  };
}

/** Ordered task list from the conversation's tasks map + taskOrder. */
export function toRemoteTasks(conv: RawConversation): RemoteTask[] | null {
  if (!conv.tasks) {
    return null;
  }
  const order =
    conv.taskOrder && conv.taskOrder.length > 0
      ? conv.taskOrder
      : Object.keys(conv.tasks);
  const tasks: RemoteTask[] = [];
  for (const id of order) {
    const t = conv.tasks[id];
    if (!t || !t.subject) {
      continue;
    }
    const status =
      t.status === "completed" || t.status === "in_progress"
        ? t.status
        : "pending";
    tasks.push({
      id: t.id ?? id,
      subject: t.subject,
      status,
      description: t.description,
      activeForm: t.activeForm,
      owner: t.owner,
      blocks: t.blocks,
      blockedBy: t.blockedBy,
    });
  }

  return tasks;
}

export function toRemoteTodos(conv: RawConversation): RemoteTodo[] | null {
  if (!conv.todos) {
    return null;
  }

  return conv.todos
    .filter((t): t is RawTodo & { content: string } => !!t.content)
    .map((t) => ({
      content: t.content,
      status:
        t.status === "completed" || t.status === "in_progress"
          ? t.status
          : "pending",
      activeForm: t.activeForm,
    }));
}

/**
 * Re-walk a conversation minting the same image ids as `toRemoteMessage`, so
 * `agents.image` can resolve an id → its base64 bytes without server state.
 */
export function findImage(
  conv: RawConversation,
  wanted: string,
): { data: string; media_type: string } | null {
  type Found = { data: string; media_type: string } | null;
  const walkTool = (messageId: string, tc: RawToolCall): Found => {
    let result: Found = null;
    const id = tc.id ?? "";
    if (Array.isArray(tc.result)) {
      tc.result.forEach((block, i) => {
        if (block.type === "image" && imageId(messageId, id, i) === wanted) {
          result = {
            data: block.source.data,
            media_type: block.source.media_type,
          };
        }
      });
    }
    if (!result && tc.children) {
      for (const c of tc.children) {
        if (c.kind === "tool_use") {
          result = walkTool(messageId, c.toolCall);
          if (result) {
            break;
          }
        }
      }
    }

    return result;
  };

  for (const m of conv.messages ?? []) {
    const messageId = m.id ?? "";
    const images = m.images ?? [];
    const msgImage = images.findIndex(
      (_img, i) => imageId(messageId, "msg", i) === wanted,
    );
    if (msgImage !== -1) {
      const img = images[msgImage];

      return { data: img.data, media_type: img.media_type };
    }
    for (const tc of m.toolCalls ?? []) {
      const found = walkTool(messageId, tc);
      if (found) {
        return found;
      }
    }
  }

  return null;
}

/**
 * Slice a transcript into a page. `before` → the page ending there (older
 * history); `after` → forward from there; neither → the tail, so a fresh open
 * lands at the newest messages and lazy-loads older ones on scroll-up.
 */
export function transcriptPage(
  conv: RawConversation,
  cursor: { after?: number; before?: number; limit?: number },
  options: VisibilityOptions = {},
): {
  messages: RemoteMessage[];
  next_after: number | null;
  prev_before: number | null;
  total: number;
} {
  const raw = conv.messages ?? [];
  const total = raw.length;
  const size = cursor.limit ?? 100;
  let start: number;
  let end: number;
  if (cursor.before != null) {
    end = Math.min(cursor.before, total);
    start = Math.max(0, end - size);
  } else if (cursor.after != null) {
    start = cursor.after;
    end = Math.min(total, start + size);
  } else {
    start = Math.max(0, total - size);
    end = total;
  }

  return {
    // Cursors index the raw history; hidden bookkeeping just thins the page.
    messages: visibleMessages<RawMessage, RawToolCall>(
      raw.slice(start, end),
      options,
    ).map(toRemoteMessage),
    next_after: end < total ? end : null,
    prev_before: start > 0 ? start : null,
    total,
  };
}

export type RemoteTranscriptDelta = z.infer<
  (typeof EventPayloads)["agent.transcript"]
>;

const remoteDeltas = new WeakMap<AgentTranscriptDelta, RemoteTranscriptDelta>();

/**
 * A host delta in the phone's terms, with `meta` the conversation's fields as
 * of that delta. Built once per delta — every subscribed connection gets the
 * same object.
 */
export function toRemoteTranscriptDelta(
  delta: AgentTranscriptDelta,
  meta: AgentConversationMeta,
): RemoteTranscriptDelta {
  const cached = remoteDeltas.get(delta);
  if (cached) {
    return cached;
  }
  const messages: RemoteMessage[] = [];
  const removed: string[] = [];
  for (const op of delta.ops) {
    if (op.op === "remove") {
      removed.push(op.id);
      continue;
    }
    const [shown] = visibleMessages<RawMessage, RawToolCall>([op.message]);
    if (shown) {
      messages.push(toRemoteMessage(shown));
    } else {
      removed.push(op.message.id);
    }
  }
  const out: RemoteTranscriptDelta = {
    agent_id: delta.agentId,
    epoch: delta.epoch,
    revision: delta.revision,
    total: delta.total,
    messages,
    removed_ids: removed,
    title: meta.title?.trim() ? meta.title : null,
    model: meta.model ?? null,
    pending_tool_name: meta.pendingToolName ?? null,
    tasks: toRemoteTasks(meta),
    todos: toRemoteTodos(meta),
    follow_ups: meta.followUps ?? [],
  };
  remoteDeltas.set(delta, out);

  return out;
}
