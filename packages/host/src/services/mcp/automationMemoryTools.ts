/**
 * `save_memory` and `delete_memory`: how a run leaves notes for the next one.
 *
 * Tools rather than `Write`, because a `propose` run may not write files, and
 * scoped to the caller's own automation so one can't rewrite another's memory.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { deleteMemory, saveMemory } from "../automation/memory/store";
import { MEMORY_TYPES } from "../automation/models";
import { automationRunForAgent } from "./automationCaller";

function textResult(text: string, isError = false) {
  return { content: [{ type: "text" as const, text }], isError };
}

function failure(e: unknown): string {
  return typeof e === "string" ? e : String(e);
}

export function registerAutomationMemoryTools(
  server: McpServer,
  callerAgentId: string | null,
): void {
  server.tool(
    "save_memory",
    "Create or overwrite one memory for this automation, so the next run starts from what you learned instead of re-exploring. Save what took real work to find and will still hold: where something is implemented, how a project is laid out, a quirk of a source, a preference the user stated. Saving an existing name replaces it — read it first and keep what's still true. The host keeps `MEMORY.md` in sync.",
    {
      name: z
        .string()
        .describe(
          "Kebab-case slug, also the file name: 'session-merge-flow'. Reuse an existing name to update it.",
        ),
      description: z
        .string()
        .describe(
          "One line shown in MEMORY.md, specific enough that a later run can tell whether to open it.",
        ),
      type: z
        .enum(MEMORY_TYPES)
        .describe(
          "`user`: who the user is. `feedback`: how they want the work done. `project`: facts about the codebase or ongoing work. `reference`: pointers to external resources.",
        ),
      body: z
        .string()
        .describe(
          "The memory in markdown. For `feedback` and `project`, follow the fact with **Why:** and **How to apply:** lines.",
        ),
    },
    async ({ name, description, type, body }) => {
      const context = automationRunForAgent(callerAgentId);
      if (!context) {
        return textResult(
          "save_memory is only available to automation runs.",
          true,
        );
      }
      try {
        saveMemory(context.automationId, { name, description, type, body });

        return textResult(`Saved memory "${name}".`);
      } catch (e) {
        return textResult(failure(e), true);
      }
    },
  );

  server.tool(
    "delete_memory",
    "Delete one of this automation's memories because it turned out wrong or no longer applies. Prefer `save_memory` to correct one that's only partly out of date.",
    {
      name: z.string().describe("The memory's name, as listed in MEMORY.md."),
    },
    async ({ name }) => {
      const context = automationRunForAgent(callerAgentId);
      if (!context) {
        return textResult(
          "delete_memory is only available to automation runs.",
          true,
        );
      }
      try {
        deleteMemory(context.automationId, name);

        return textResult(`Deleted memory "${name}".`);
      } catch (e) {
        return textResult(failure(e), true);
      }
    },
  );
}
