/**
 * MCP tools only an automation run's agent can see.
 *
 * Registration is bound to caller identity, not to a prompt: the tool exists
 * on the connection only when that connection's agent lives in an
 * `automation_host` session. An ordinary agent cannot call `emit_proposal`
 * or `emit_report` because they are not on its tool list at all.
 *
 * The inbox tools are scoped tighter still: a run reads and clears only its
 * own automation's proposals, so one automation can never decide for another.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { autoStartIfAllowed } from "../automation/autoStart";
import {
  createProposal,
  supersedeProposals,
} from "../automation/proposals/manager";
import {
  automationRunForAgent,
  isAutomationHostAgent,
} from "./automationCaller";
import { registerAutomationInboxTools } from "./automationInboxTools";
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
  registerAutomationInboxTools(server, callerAgentId);

  server.tool(
    "emit_proposal",
    "Propose one piece of work to the user. Call it once per item you want to put in front of them — never batch several items into one proposal, and never propose something you did not actually find in the data you were given. Proposals land in the user's inbox, where they either start a session from one or dismiss it. This does not start any work. An earlier run may already have proposed the same thing — check `list_open_proposals` and pass `supersedes` rather than adding a second copy of it.",
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
      cta: z
        .object({
          kind: z
            .enum(["open_url", "start_session"])
            .describe(
              "'start_session' when an agent should go and do the work in a worktree. 'open_url' when the next move is a human's — read a PR, request a review, reply on a ticket.",
            ),
          label: z
            .string()
            .describe(
              "Button text. Imperative and specific: 'Start', 'Open PR #6478', 'Review the migration plan'.",
            ),
          url: z
            .string()
            .optional()
            .describe(
              "Where 'open_url' goes. Defaults to the source_ref url. Point it at whatever the user should actually look at, which is not always the item the proposal came from.",
            ),
        })
        .optional()
        .describe(
          "The single action you are asking for. Omit it when there is nothing to do but read the proposal and dismiss it — the inbox then shows no button rather than offering work that does not exist.",
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
      supersedes: z
        .array(z.string())
        .optional()
        .describe(
          "Ids of this automation's still-waiting proposals that this one replaces, from `list_open_proposals`. They leave the inbox pointing at this proposal, so the user decides once instead of on three copies of the same thing. Only pass ids covering the same work — a proposal about something else is not superseded, it is withdrawn or left alone.",
        ),
    },
    async ({
      title,
      summary,
      confidence,
      rationale,
      recommended_action,
      cta,
      source_ref,
      repo_root,
      supersedes,
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
        cta: cta ?? null,
        source_ref: source_ref ?? null,
        repo_root: repo_root ?? null,
      });

      // Clearing the ones it replaces happens before the gate: what the run
      // needs back is what the inbox now holds, gate decision included.
      const superseded = supersedes?.length
        ? supersedeProposals(supersedes, created)
        : [];

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
                cta: proposal.cta,
                gate: decision.reason,
                superseded,
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
