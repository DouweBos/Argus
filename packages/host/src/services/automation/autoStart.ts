/**
 * The gate, applied to one proposal.
 *
 * `emit_proposal` calls `gateProposal` synchronously so the tool can answer
 * with the status it landed at, then the session comes up in the background.
 * The decision is a Node `if` over persisted state — a playbook that tells the
 * agent to start a session anyway changes nothing here.
 */

import type { GateDecision } from "./guardrails";
import type { Proposal } from "./proposals/models";
import { error, info } from "@argus/host/logger";
import { countActiveAutomationSessions, resolvePolicy } from "./autonomy";
import { evaluateAutoStart } from "./guardrails";
import { getAutomation } from "./manager";
import { acceptProposal } from "./proposals/accept";
import { updateProposal } from "./proposals/manager";
import { dailyBudgetBlock, runBudgetBlock } from "./spend";

/** Decide whether a freshly emitted proposal may start its own session. */
export function gateProposal(proposal: Proposal): GateDecision {
  const automation = getAutomation(proposal.automation_id);
  if (!automation) {
    return { allowed: false, reason: "the automation no longer exists" };
  }

  const policy = resolvePolicy(automation, proposal.repo_root);
  if (policy.disabledByProject) {
    return {
      allowed: false,
      reason: "this project has the automation disabled",
    };
  }
  const active = countActiveAutomationSessions(automation.id);
  const costBlock =
    dailyBudgetBlock() ??
    runBudgetBlock(proposal.run_id, policy.guardrails.max_cost_usd_per_run);

  return evaluateAutoStart({
    costBlock,
    recommendedAction: proposal.recommended_action,
    confidence: proposal.confidence,
    repoRoot: proposal.repo_root,
    autonomy: policy.autonomy,
    guardrails: policy.guardrails,
    activeForAutomation: active.forAutomation,
    activeTotal: active.total,
    maxTotalSessions: policy.maxTotalSessions,
  });
}

export interface AutoStartOutcome {
  proposal: Proposal;
  decision: GateDecision;
}

/**
 * Run the gate and, when it opens, flip the proposal to `auto_started` before
 * returning — the slot must be taken by the time the next `emit_proposal`
 * call is gated, or two proposals emitted back to back both see it free.
 */
export function autoStartIfAllowed(proposal: Proposal): AutoStartOutcome {
  const decision = gateProposal(proposal);
  if (!decision.allowed) {
    info(`Proposal ${proposal.id} stays pending: ${decision.reason}`);

    return { proposal, decision };
  }

  const claimed = updateProposal(proposal.id, { status: "auto_started" });

  acceptProposal(proposal.id, { status: "auto_started" }).catch(
    (e: unknown) => {
      const message = typeof e === "string" ? e : String(e);
      error(`Auto-starting proposal ${proposal.id} failed: ${message}`);
      // Hand it back to the inbox rather than leaving a slot held by a
      // session that never came up.
      updateProposal(proposal.id, { status: "pending", session_id: null });
    },
  );

  return { proposal: claimed, decision };
}
