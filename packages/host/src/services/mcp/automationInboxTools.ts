/**
 * The inbox, as a run sees it: `list_open_proposals` and `withdraw_proposal`.
 *
 * A run that cannot see what it already proposed has no choice but to propose
 * it again, which is how an inbox nobody emptied fills up with yesterday's
 * work. Both tools are scoped to the caller's own automation — clearing
 * someone else's proposal is not a thing a run may do, whatever it asks for.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getProposal, withdrawProposal } from "../automation/proposals/manager";
import {
  outstandingProposals,
  proposalAge,
} from "../automation/proposals/outstanding";
import { automationRunForAgent } from "./automationCaller";

function textResult(text: string, isError = false) {
  return { content: [{ type: "text" as const, text }], isError };
}

function jsonResult(value: unknown) {
  return textResult(JSON.stringify(value, null, 2));
}

export function registerAutomationInboxTools(
  server: McpServer,
  callerAgentId: string | null,
): void {
  server.tool(
    "list_open_proposals",
    "List this automation's proposals that are still waiting on the user. Read it before you propose anything: if one of these already covers what you found, supersede it from `emit_proposal` instead of proposing it again, and if the thing behind it is gone, withdraw it. Only this automation's proposals are visible.",
    {},
    async () => {
      const context = automationRunForAgent(callerAgentId);
      if (!context) {
        return textResult(
          "list_open_proposals is only available to automation runs.",
          true,
        );
      }

      const proposals = outstandingProposals(context.automationId).map((p) => ({
        proposal_id: p.id,
        title: p.title,
        summary: p.summary,
        rationale: p.rationale,
        confidence: p.confidence,
        recommended_action: p.recommended_action,
        source_ref: p.source_ref,
        repo_root: p.repo_root,
        age: proposalAge(p.created_at),
        created_at: p.created_at,
        /** True when this run raised it, so re-proposing it is your own echo. */
        from_this_run: p.run_id === context.runId,
      }));

      return jsonResult({ count: proposals.length, proposals });
    },
  );

  server.tool(
    "withdraw_proposal",
    "Take a proposal out of the user's inbox on their behalf, because what it was asking about is gone — the PR was merged or closed, the issue was closed, the branch was deleted, someone did the work. Use it only when you checked and know; a proposal that is merely old is still a decision the user gets to make. This does not count against the automation's track record the way a dismissal does.",
    {
      proposal_id: z
        .string()
        .describe("Id from `list_open_proposals` or the inbox block."),
      reason: z
        .string()
        .describe(
          "What you found, in one line, citing the evidence: 'PR #6478 was merged on Tuesday'. The user sees this where the proposal was.",
        ),
    },
    async ({ proposal_id, reason }) => {
      const context = automationRunForAgent(callerAgentId);
      if (!context) {
        return textResult(
          "withdraw_proposal is only available to automation runs.",
          true,
        );
      }

      const proposal = getProposal(proposal_id);
      if (!proposal || proposal.automation_id !== context.automationId) {
        return textResult(
          `No proposal of this automation with id ${proposal_id}.`,
          true,
        );
      }
      if (!reason.trim()) {
        return textResult(
          "Withdrawing needs a reason — the user sees it where the proposal was.",
          true,
        );
      }

      try {
        const withdrawn = withdrawProposal(proposal_id, reason);

        return jsonResult({
          proposal_id: withdrawn.id,
          status: withdrawn.status,
          reason: withdrawn.cleared_reason,
        });
      } catch (e) {
        return textResult(String(e), true);
      }
    },
  );
}
