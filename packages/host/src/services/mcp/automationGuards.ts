/**
 * Autonomy checks applied to the *ordinary* MCP tools when the caller is an
 * automation host.
 *
 * `emit_proposal` is not the only way a run could start work — `create_session`
 * plus `spawn_agent` would do it, and `merge_session` would finish it. Those
 * tools stay on the list (a `draft`-level run legitimately needs them), so the
 * ladder is enforced here instead. A playbook cannot argue past this: it is a
 * refusal returned from the tool call itself.
 */

import type { Session } from "../session/models";
import { appState } from "../../state";
import { resolvePolicy } from "../automation/autonomy";
import { evaluateMerge, atLeastAutonomy } from "../automation/guardrails";
import { getAutomation } from "../automation/manager";
import { branchChecksClean } from "../github/checks";
import { automationRunForAgent } from "./automationTools";

/** The automation behind a caller, with its policy resolved for `repoRoot`. */
export function callerPolicy(
  callerAgentId: string | null,
  repoRoot: string | null,
) {
  const context = automationRunForAgent(callerAgentId);
  if (!context) {
    return null;
  }
  const automation = getAutomation(context.automationId);
  if (!automation) {
    return null;
  }

  return { automation, policy: resolvePolicy(automation, repoRoot) };
}

/**
 * Refusal text when an automation host below `draft` tries to create a session
 * or spawn an agent. Null means "not an automation, or allowed".
 */
export function automationWorkBlock(
  callerAgentId: string | null,
  repoRoot: string | null,
): string | null {
  const resolved = callerPolicy(callerAgentId, repoRoot);
  if (!resolved) {
    return null;
  }
  if (resolved.policy.disabledByProject) {
    return "Refused: this project has the automation disabled. Emit a proposal instead.";
  }
  if (!atLeastAutonomy(resolved.policy.autonomy, "draft")) {
    return `Refused: this automation runs at autonomy "${resolved.policy.autonomy}", which cannot start work. Call emit_proposal instead — a human decides from the inbox.`;
  }

  return null;
}

/** Refusal text when an automation host tries to merge below `auto_merge`. */
export async function automationMergeBlock(
  callerAgentId: string | null,
  session: Session,
): Promise<string | null> {
  const resolved = callerPolicy(callerAgentId, session.repo_root);
  if (!resolved) {
    return null;
  }
  const { policy } = resolved;
  if (!atLeastAutonomy(policy.autonomy, "auto_merge")) {
    return `Refused: this automation runs at autonomy "${policy.autonomy}"; merging needs "auto_merge". Leave the branch for a human.`;
  }

  const ciClean = policy.guardrails.require_clean_ci
    ? await branchChecksClean(session.repo_root, session.branch)
    : true;
  const decision = evaluateMerge({
    autonomy: policy.autonomy,
    guardrails: policy.guardrails,
    ciClean,
  });

  return decision.allowed ? null : `Refused: ${decision.reason}.`;
}

/** Session lookup by id for the automation-only tools. */
export function sessionById(id: string): Session | null {
  return appState.sessions.get(id) ?? null;
}
