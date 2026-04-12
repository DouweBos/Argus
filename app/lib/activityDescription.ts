/**
 * Derive a human-readable activity description from the agent's current state.
 *
 * Maps tool names and event context to short phrases like "Editing file",
 * "Running command", "Waiting for permission", etc.
 *
 * Inspired by Plaude's `SessionInfo.activityDescription` / `toolVerb()`.
 */

// ---------------------------------------------------------------------------
// Tool name → verb mapping
// ---------------------------------------------------------------------------

const TOOL_VERBS: Record<string, string> = {
  Agent: "Running agent",
  Bash: "Running command",
  Edit: "Editing file",
  Glob: "Finding files",
  Grep: "Searching code",
  MultiEdit: "Editing files",
  NotebookEdit: "Editing notebook",
  Read: "Reading file",
  WebFetch: "Fetching URL",
  WebSearch: "Searching web",
  Write: "Writing file",
};

/**
 * Return a short verb phrase for a tool, e.g. "Editing file".
 * Falls back to "Using <tool>" for unknown tools.
 */
export function toolVerb(toolName: string): string {
  return TOOL_VERBS[toolName] ?? `Using ${toolName}`;
}

/**
 * Return a richer description that includes context from the tool input.
 *
 * Examples:
 * - `("Bash", { command: "npm install" })` → "Running command"
 * - `("Edit", { file_path: "/src/main.ts" })` → "Editing main.ts"
 * - `("Read", { file_path: "/src/lib/utils.ts" })` → "Reading utils.ts"
 * - `("Grep", { pattern: "TODO" })` → "Searching code"
 * - `("WebFetch", { url: "https://example.com" })` → "Fetching example.com"
 */
export function toolActivity(
  toolName: string,
  toolInput?: Record<string, unknown>,
): string {
  if (!toolInput) {
    return toolVerb(toolName);
  }

  switch (toolName) {
    case "Edit":
    case "MultiEdit":
    case "Write":
    case "Read": {
      const fp = (toolInput.file_path as string) ?? (toolInput.path as string);
      if (typeof fp === "string") {
        const basename = fp.split("/").pop() ?? fp;
        const verb = toolName === "Read" ? "Reading" : "Editing";

        return toolName === "Write"
          ? `Writing ${basename}`
          : `${verb} ${basename}`;
      }

      return toolVerb(toolName);
    }

    case "WebFetch": {
      const url = toolInput.url;
      if (typeof url === "string") {
        try {
          const hostname = new URL(url).hostname;

          return `Fetching ${hostname}`;
        } catch {
          return toolVerb(toolName);
        }
      }

      return toolVerb(toolName);
    }

    case "Glob": {
      const pattern = toolInput.pattern;
      if (typeof pattern === "string") {
        return `Finding ${pattern}`;
      }

      return toolVerb(toolName);
    }

    case "Grep": {
      const pattern = toolInput.pattern;
      if (typeof pattern === "string") {
        const short =
          pattern.length > 20 ? pattern.slice(0, 20) + "..." : pattern;

        return `Searching for "${short}"`;
      }

      return toolVerb(toolName);
    }

    default:
      return toolVerb(toolName);
  }
}

// ---------------------------------------------------------------------------
// Activity state
// ---------------------------------------------------------------------------

export type ActivityState = "blocked" | "idle" | "stopped" | "working";

export interface Activity {
  /** Short description: "Editing main.ts", "Thinking", "Waiting for permission", etc. */
  description: string;
  /** Semantic state for styling (dot color, animation). */
  state: ActivityState;
}

/**
 * Derive the current activity from conversation + agent state.
 *
 * @param agentStatus - From the agent store (running/idle/stopped/error).
 * @param lastEventType - The lastEventType from conversationStore.
 * @param pendingToolName - Name of the tool currently waiting for result (if any).
 * @param pendingToolInput - Input of the tool currently waiting for result (if any).
 * @param hasPendingPermission - Whether any tool call has pendingPermission = true.
 */
export function deriveActivity(
  agentStatus: "error" | "idle" | "running" | "stopped" | null | undefined,
  lastEventType: string | undefined,
  pendingToolName: string | null,
  pendingToolInput: Record<string, unknown> | null,
  hasPendingPermission: boolean,
): Activity {
  if (!agentStatus || agentStatus === "stopped" || agentStatus === "error") {
    return { description: "Stopped", state: "stopped" };
  }

  if (agentStatus === "idle") {
    return { description: "Idle", state: "idle" };
  }

  // agentStatus === "running"
  if (hasPendingPermission) {
    return { description: "Waiting for permission", state: "blocked" };
  }

  if (pendingToolName) {
    return {
      description: toolActivity(pendingToolName, pendingToolInput ?? undefined),
      state: "working",
    };
  }

  // No specific tool running — use lastEventType for context.
  if (lastEventType === "user_sent") {
    return { description: "Processing prompt", state: "working" };
  }

  if (lastEventType?.startsWith("system:api_retry")) {
    return { description: "Retrying API call", state: "working" };
  }

  return { description: "Thinking", state: "working" };
}
