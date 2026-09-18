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
import {
  automationOwningSession,
  recordAutomationSession,
} from "../automation/ownedSessions";
import { listProposals } from "../automation/proposals/manager";
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

/**
 * Claim a session an automation host just created, so it counts against the
 * automation's concurrency and is recognised as its own by the shell guard.
 */
export function recordAutomationSessionForCaller(
  callerAgentId: string | null,
  sessionId: string,
): void {
  const context = automationRunForAgent(callerAgentId);
  if (!context) {
    return;
  }
  recordAutomationSession(context.automationId, context.runId, sessionId);
}

/** Whether `sessionId` is one this automation started. */
function ownsSession(automationId: string, sessionId: string): boolean {
  if (automationOwningSession(sessionId)?.automation_id === automationId) {
    return true;
  }

  return listProposals({ automationId, status: "auto_started" }).some(
    (p) => p.session_id === sessionId,
  );
}

/**
 * Refusal text when an automation host reaches into a session with one of the
 * tools that act on an existing one — `write_session_file`, `trigger_run`,
 * `delete_session`. Two conditions, both of which `automationWorkBlock` alone
 * would miss: the ladder (a `propose` run may not act at all) and ownership (a
 * run may not edit, run or delete a session a human made).
 */
export function automationSessionToolBlock(
  callerAgentId: string | null,
  session: Session,
  action: string,
): string | null {
  const resolved = callerPolicy(callerAgentId, session.repo_root);
  if (!resolved) {
    return null;
  }
  const ladder = automationWorkBlock(callerAgentId, session.repo_root);
  if (ladder) {
    return ladder;
  }
  const run = automationRunForAgent(callerAgentId);
  const isOwnHost = run !== null && session.kind === "automation_host";
  if (isOwnHost || ownsSession(resolved.automation.id, session.id)) {
    return null;
  }

  return `Refused: ${action} targets session "${session.display_name || session.branch}", which this automation did not create. Automations may only act on their own sessions — emit a proposal if a human should touch this one.`;
}
