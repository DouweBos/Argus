/** Finding and updating a tool call anywhere in a conversation's tree. */

import type {
  ConversationMessage,
  ToolCallInfo,
  ToolResultBlock,
} from "./types";

/**
 * Normalize a raw tool_result `content` into what the store keeps. Block types
 * the UI has no renderer for (e.g. ToolSearch's `tool_reference`) become text,
 * otherwise they render as empty result rows.
 */
export function toToolResult(raw: unknown): ToolResultBlock[] | string {
  if (typeof raw === "string") {
    return raw;
  }
  if (!Array.isArray(raw)) {
    return JSON.stringify(raw, null, 2);
  }

  const blocks: ToolResultBlock[] = [];
  const toolNames: string[] = [];
  for (const block of raw as Record<string, unknown>[]) {
    if (block?.type === "image") {
      blocks.push(block as ToolResultBlock);
    } else if (block?.type === "tool_reference") {
      if (typeof block.tool_name === "string") {
        toolNames.push(block.tool_name);
      }
    } else if (typeof block?.text === "string") {
      blocks.push({ type: "text", text: block.text });
    }
  }
  if (toolNames.length > 0) {
    blocks.push({ type: "text", text: toolNames.join("\n") });
  }

  return blocks;
}

/**
 * Walk a tool call tree and apply `updater` to the call whose id matches.
 * Returns a new tool call with updated descendants, or null if not found.
 */
function updateToolCallTree(
  tc: ToolCallInfo,
  id: string,
  updater: (tc: ToolCallInfo) => ToolCallInfo,
): ToolCallInfo | null {
  if (tc.id === id) {
    return updater(tc);
  }
  if (!tc.children || tc.children.length === 0) {
    return null;
  }
  let changed = false;
  const nextChildren = tc.children.map((child) => {
    if (child.kind !== "tool_use") {
      return child;
    }
    const updated = updateToolCallTree(child.toolCall, id, updater);
    if (updated) {
      changed = true;

      return { kind: "tool_use" as const, toolCall: updated };
    }

    return child;
  });

  return changed ? { ...tc, children: nextChildren } : null;
}

/**
 * Scan all messages for the tool call with `id`, applying `updater`. Returns
 * new messages array if found (with that tool call updated), or null.
 */
export function updateToolCallInMessages(
  messages: ConversationMessage[],
  id: string,
  updater: (tc: ToolCallInfo) => ToolCallInfo,
): ConversationMessage[] | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    let changed = false;
    const nextCalls = msg.toolCalls.map((tc) => {
      const updated = updateToolCallTree(tc, id, updater);
      if (updated) {
        changed = true;

        return updated;
      }

      return tc;
    });
    if (changed) {
      const next = [...messages];
      next[i] = { ...msg, toolCalls: nextCalls };

      return next;
    }
  }

  return null;
}
