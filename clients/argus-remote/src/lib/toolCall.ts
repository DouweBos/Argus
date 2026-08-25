/**
 * Tool-call presentation helpers — a port of Peacock's `ToolCall/helpers.ts`,
 * trimmed to what the phone client renders.
 */

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

/** Format input params for display — Bash commands plain, others as JSON. */
export function formatInput(
  name: string,
  input: Record<string, unknown>,
): string {
  if (name === "Bash" && input.command) {
    return input.command as string;
  }

  return JSON.stringify(input, null, 2);
}
