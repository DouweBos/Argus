import type { ToolResultBlock } from "../stores/conversationStore";

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
