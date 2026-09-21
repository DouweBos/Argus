/**
 * MCP tools only an automation run's agent can see.
 *
 * Registration is bound to caller identity, not to a prompt: the tool exists
 * on the connection only when that connection's agent lives in an
 * `automation_host` session. An ordinary agent cannot call `emit_proposal`
 * or `emit_report` because they are not on its tool list at all.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { autoStartIfAllowed } from "../automation/autoStart";
import { createProposal } from "../automation/proposals/manager";
import {
  automationRunForAgent,
  isAutomationHostAgent,
} from "./automationCaller";
import { registerAutomationPrTool } from "./automationPrTool";
import { registerAutomationReportTool } from "./automationReportTool";

export function registerAutomationTools(
  server: McpServer,
  callerAgentId: string | null,
): void {
  if (!isAutomationHostAgent(callerAgentId)) {
    return;
  }

  registerAutomationPrTool(server, callerAgentId);
  registerAutomationReportTool(server, callerAgentId);

  server.tool(
    "emit_proposal",
    "Propose one piece of work to the user. Call it once per item you want to put in front of them — never batch several items into one proposal, and never propose something you did not actually find in the data you were given. Proposals land in the user's inbox, where they either start a session from one or dismiss it. This does not start any work.",
    {
      title: z
        .string()
        .describe(
          "One line, imperative, what should happen. e.g. 'Fix the null crash in SessionList'.",
        ),
      summary: z
        .string()
        .describe(
          "A few sentences: what the work is and what done looks like. Markdown.",
        ),
      confidence: z
        .number()
        .min(0)
        .max(1)
        .describe(
          "How sure you are this is worth doing and is well enough understood to act on. Be honest — an inflated number makes the whole inbox worth less.",
        ),
      rationale: z
        .string()
        .describe(
          "Why you ranked it where you did, citing what you actually saw (labels, age, who is blocked).",
        ),
      recommended_action: z
        .enum(["ignore", "needs_info", "review", "start_session"])
        .describe(
          "What you think should happen: 'start_session' to do the work, 'review' for a human read, 'needs_info' when the item is ambiguous, 'ignore' to note it and move on.",
        ),
      source_ref: z
        .object({
          source_id: z.string().describe("Signal source id, e.g. 'github'."),
          external_id: z
            .string()
            .describe("Id within that source, e.g. 'plexinc/app#412'."),
          url: z.string().describe("Link a human can open."),
        })
        .optional()
        .describe(
          "The work item this proposal came from. Pass it through verbatim from the item you were given.",
        ),
      repo_root: z
        .string()
        .optional()
        .describe(
          "Absolute path of the project the work would happen in. Required for the user to be able to start a session from this proposal — use the work item's repo_root when it has one.",
        ),
    },
    async ({
      title,
      summary,
      confidence,
      rationale,
      recommended_action,
      source_ref,
      repo_root,
    }) => {
      const context = automationRunForAgent(callerAgentId);
      if (!context) {
        return {
          content: [
            {
              type: "text" as const,
              text: "emit_proposal is only available to automation runs.",
            },
          ],
          isError: true,
        };
      }

      const created = createProposal({
        run_id: context.runId,
        automation_id: context.automationId,
        title,
        summary,
        confidence,
        rationale,
        recommended_action,
        source_ref: source_ref ?? null,
        repo_root: repo_root ?? null,
      });

      // The gate. Every rung, threshold and cap is decided in Node from
      // persisted state — a playbook instructing the agent to start work
      // regardless changes nothing about what happens on this line.
      const { proposal, decision } = autoStartIfAllowed(created);

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(
              {
                proposal_id: proposal.id,
                status: proposal.status,
                gate: decision.reason,
              },
              null,
              2,
            ),
          },
        ],
      };
    },
  );
}
