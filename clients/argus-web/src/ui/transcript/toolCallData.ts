/**
 * Wire tool calls and messages in the shapes Peacock draws. Pure, so the
 * live chat and a saved one read the same.
 */

import type { ToolCallData, ToolResultBlockData } from "@argus/peacock";
import type { RemoteMessage, RemoteToolCall } from "../../lib/protocol";

export type ImageBlock = Extract<ToolResultBlockData, { type: "image" }>;

export function toToolCallData(tc: RemoteToolCall): ToolCallData {
  const pending = tc.status === "pending" || !!tc.pending_permission;
  const running = tc.status === "running";
  const result: ToolCallData["result"] =
    pending || running
      ? undefined
      : tc.result_blocks.map(
          (b): ToolResultBlockData =>
            b.type === "image"
              ? { type: "image", mediaType: b.media_type, imageId: b.image_id }
              : { type: "text", text: b.text },
        );

  return {
    id: tc.id,
    name: tc.name,
    input: tc.input,
    isError: tc.is_error ?? tc.status === "error",
    pendingPermission: pending,
    result,
    children: tc.children?.map((c) =>
      c.kind === "text"
        ? { kind: "text" as const, text: c.text }
        : { kind: "tool_use" as const, toolCall: toToolCallData(c.tool_call) },
    ),
  };
}

/** Every image id a transcript references, for lazy preloading. */
export function collectImageIds(messages: RemoteMessage[]): string[] {
  const ids: string[] = [];
  const walk = (tc: RemoteToolCall) => {
    for (const b of tc.result_blocks) {
      if (b.type === "image") {
        ids.push(b.image_id);
      }
    }
    tc.children?.forEach((c) => {
      if (c.kind === "tool_use") {
        walk(c.tool_call);
      }
    });
  };
  for (const m of messages) {
    (m.images ?? []).forEach((img) => ids.push(img.image_id));
    m.tool_calls.forEach(walk);
  }

  return ids;
}

/** An MCP push's label, "parent → tool" when another agent sent it. */
export function mcpLabel(msg: RemoteMessage): { label: string } | undefined {
  if (msg.role !== "system" || msg.source?.kind !== "mcp") {
    return undefined;
  }

  return {
    label: msg.source.parent_label?.trim()
      ? `${msg.source.parent_label} → ${msg.source.tool}`
      : `MCP · ${msg.source.tool}`,
  };
}
