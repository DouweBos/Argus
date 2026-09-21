/**
 * Who is calling: the automation run behind an MCP connection, if any.
 *
 * A leaf on purpose. `automationTools` registers the sub-tools, and each of
 * them needs to know the caller — with this lookup living in `automationTools`
 * that was a cycle in both directions.
 */

import { appState } from "../../state";
import { listAutomationRuns } from "../automation/manager";

/** The run an agent is the host of, or null if it is not an automation host. */
export function automationRunForAgent(
  callerAgentId: string | null,
): { automationId: string; runId: string } | null {
  if (!callerAgentId) {
    return null;
  }
  const sessionId = appState.agents.get(callerAgentId)?.sessionId;
  if (!sessionId) {
    return null;
  }
  if (appState.sessions.get(sessionId)?.kind !== "automation_host") {
    return null;
  }
  const run = listAutomationRuns().find((r) => r.host_session_id === sessionId);

  return run ? { automationId: run.automation_id, runId: run.id } : null;
}

export function isAutomationHostAgent(callerAgentId: string | null): boolean {
  return automationRunForAgent(callerAgentId) !== null;
}
