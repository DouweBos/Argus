import type { BackgroundTaskData } from "../BackgroundTaskStatus/backgroundTask";

export type ToolResultBlockData =
  | { type: "image"; mediaType: string; imageId?: string; data?: string }
  | { type: "text"; text: string };

export type ToolCallChildData =
  | { kind: "text"; text: string }
  | { kind: "tool_use"; toolCall: ToolCallData };

export interface ToolCallData {
  id: string;
  name: string;
  input: Record<string, unknown>;
  /** String for plain text results; blocks for rich results (e.g. images). */
  result?: ToolResultBlockData[] | string;
  isError?: boolean;
  pendingPermission?: boolean;
  children?: ToolCallChildData[];
  /** Set when it keeps running past its tool_result (`run_in_background`). */
  background?: BackgroundTaskData;
}

const PATH_SUMMARY_TOOLS = new Set([
  "Read",
  "Edit",
  "MultiEdit",
  "Write",
  "LS",
]);

export function isPathTool(name: string): boolean {
  return PATH_SUMMARY_TOOLS.has(name);
}

/** Short human-readable summary from tool name + input. */
export function toolSummary(
  name: string,
  input: Record<string, unknown>,
): string {
  switch (name) {
    case "Edit":
    case "MultiEdit":
    case "Write":
    case "Read":
      return (input.file_path ?? input.path ?? "") as string;

    case "Bash":
      return ((input.command ?? "") as string).slice(0, 60);

    case "Glob":
    case "Grep":
      return (input.pattern ?? "") as string;

    case "LS":
      return (input.path ?? ".") as string;

    case "Task":
      return ((input.description ?? "") as string).slice(0, 60);

    case "WebSearch":
      return ((input.query ?? "") as string).slice(0, 60);

    case "WebFetch":
      return ((input.url ?? "") as string).slice(0, 60);

    case "Agent": {
      const type = (input.subagent_type ?? "") as string;
      const desc = (input.description ?? "") as string;
      const label = type || "Agent";

      return desc ? `${label}: ${desc.slice(0, 80)}` : label;
    }

    default:
      return "";
  }
}

/** Coerce a tool result to a renderable string (for previews / clipboard). */
export function safeResultText(result: ToolCallData["result"]): string {
  if (typeof result === "string") {
    return result;
  }
  if (result == null) {
    return "";
  }

  return result
    .map((block) => (block.type === "text" ? block.text : `[${block.type}]`))
    .join("\n");
}
