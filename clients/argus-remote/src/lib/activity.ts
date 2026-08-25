/**
 * Activity/status derivation for the remote client — a trimmed port of the
 * desktop's `activityDescription` + `spinnerVerbs`. Maps the agent's status and
 * currently-executing tool to a short phrase ("Editing main.ts", "Running
 * command", …) with a whimsical "Thinking" fallback verb.
 */

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

function toolVerb(toolName: string): string {
  return TOOL_VERBS[toolName] ?? `Using ${toolName}`;
}

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

        return toolName === "Read" ? `Reading ${basename}` : `Editing ${basename}`;
      }

      return toolVerb(toolName);
    }
    case "WebFetch": {
      const url = toolInput.url;
      if (typeof url === "string") {
        try {
          return `Fetching ${new URL(url).hostname}`;
        } catch {
          return toolVerb(toolName);
        }
      }

      return toolVerb(toolName);
    }
    case "Glob": {
      const pattern = toolInput.pattern;

      return typeof pattern === "string"
        ? `Finding ${pattern}`
        : toolVerb(toolName);
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

export type ActivityState = "blocked" | "idle" | "stopped" | "working";

export interface Activity {
  description: string;
  state: ActivityState;
}

export function deriveActivity(
  status: string | undefined,
  pendingToolName: string | null,
  pendingToolInput: Record<string, unknown> | null,
  hasPendingPermission: boolean,
): Activity {
  if (!status || status === "stopped" || status === "error") {
    return { description: "Stopped", state: "stopped" };
  }
  if (status === "idle") {
    return { description: "Idle", state: "idle" };
  }
  // running / requires_action
  if (hasPendingPermission) {
    return { description: "Waiting for permission", state: "blocked" };
  }
  if (pendingToolName) {
    return {
      description: toolActivity(pendingToolName, pendingToolInput ?? undefined),
      state: "working",
    };
  }

  return { description: "Thinking", state: "working" };
}

// Whimsical fallback verbs shown while the agent is "Thinking" (mirrors the
// desktop's spinner). Trimmed to a representative set.
const SPINNER_VERBS = [
  "Accomplishing",
  "Architecting",
  "Baking",
  "Brewing",
  "Cerebrating",
  "Churning",
  "Coalescing",
  "Cogitating",
  "Computing",
  "Concocting",
  "Conjuring",
  "Contemplating",
  "Cooking",
  "Crafting",
  "Crunching",
  "Crystallizing",
  "Deciphering",
  "Deliberating",
  "Determining",
  "Divining",
  "Effecting",
  "Elucidating",
  "Envisioning",
  "Fermenting",
  "Forging",
  "Formulating",
  "Generating",
  "Germinating",
  "Hatching",
  "Ideating",
  "Imagining",
  "Incubating",
  "Inferring",
  "Manifesting",
  "Marinating",
  "Mulling",
  "Musing",
  "Noodling",
  "Orchestrating",
  "Percolating",
  "Pondering",
  "Processing",
  "Puzzling",
  "Ruminating",
  "Simmering",
  "Sketching",
  "Spinning",
  "Sprouting",
  "Stewing",
  "Synthesizing",
  "Tinkering",
  "Transmuting",
  "Unfurling",
  "Unraveling",
  "Whisking",
  "Working",
  "Wrangling",
];

export function randomSpinnerVerb(): string {
  return SPINNER_VERBS[Math.floor(Math.random() * SPINNER_VERBS.length)]!;
}
