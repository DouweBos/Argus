const TOOL_LABELS: Record<string, string> = {
  Agent: "Delegate to subagent",
  AskUserQuestion: "Ask you a question",
  Bash: "Run a shell command",
  Edit: "Edit a file",
  ExitPlanMode: "Exit plan mode",
  Glob: "Find files",
  Grep: "Search files",
  MultiEdit: "Edit a file",
  NotebookEdit: "Edit Jupyter notebook",
  Read: "Read a file",
  Task: "Delegate to subagent",
  TodoWrite: "Update todo list",
  WebFetch: "Fetch a web page",
  WebSearch: "Search the web",
  Write: "Write a file",
};

function humanizeSegment(segment: string): string {
  const spaced = segment.replace(/[-_]+/g, " ").trim();
  if (!spaced) {
    return segment;
  }

  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

export function formatToolName(toolName: string): string {
  if (TOOL_LABELS[toolName]) {
    return TOOL_LABELS[toolName];
  }

  if (toolName.startsWith("mcp__")) {
    const parts = toolName.split("__").filter(Boolean);

    if (parts.length >= 3) {
      const [, server, ...rest] = parts;

      return `MCP: ${humanizeSegment(server)} / ${humanizeSegment(rest.join(" "))}`;
    }

    if (parts.length === 2) {
      return `MCP: ${humanizeSegment(parts[1])}`;
    }
  }

  return toolName;
}
