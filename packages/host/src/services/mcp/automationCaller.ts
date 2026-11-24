/**
 * Who is calling: the automation run behind an MCP connection, if any.
 *
 * A leaf on purpose. `automationTools` registers the sub-tools, and each of
 * them needs to know the caller — with this lookup living in `automationTools`
 * that was a cycle in both directions.
 */

import type { MemoryOwner } from "../automation/models";
import type { WorktreePurpose } from "../session/worktreeLocationCore";
import { appState } from "../../state";
import { getAutomation, listAutomationRuns } from "../automation/manager";
import { memoryOwnerForAutomation } from "../automation/memory/owner";
import { worktreesRoot } from "../session/git";
import { isInsideRoot } from "../session/worktreeLocation";
import { teammateThreadForSession } from "../teammate/threadSessions";

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

/** The teammate conversation an agent is having, if it is having one. */
export function teammateThreadForAgent(
  callerAgentId: string | null,
): { teammateId: string; threadId: string } | null {
  const sessionId = callerAgentId
    ? appState.agents.get(callerAgentId)?.sessionId
    : undefined;

  return teammateThreadForSession(sessionId);
}

/** The memory an agent may write with `save_memory`, or null when it has none. */
export function memoryOwnerForAgent(
  callerAgentId: string | null,
): MemoryOwner | null {
  const thread = teammateThreadForAgent(callerAgentId);
  if (thread) {
    return { kind: "teammate", id: thread.teammateId };
  }
  const run = automationRunForAgent(callerAgentId);
  const automation = run ? getAutomation(run.automationId) : null;

  return automation ? memoryOwnerForAutomation(automation) : null;
}

export function isAutomationHostAgent(callerAgentId: string | null): boolean {
  return (
    automationRunForAgent(callerAgentId) !== null ||
    teammateThreadForAgent(callerAgentId) !== null
  );
}

/**
 * Which worktree location a session this agent creates should use.
 *
 * The automation host obviously counts, and so does an agent already working
 * inside an automation worktree — a session it spawns is part of the same
 * unattended pile and belongs on the same drive.
 */
export function worktreePurposeForCaller(
  callerAgentId: string | null,
): WorktreePurpose {
  if (isAutomationHostAgent(callerAgentId)) {
    return "automation";
  }

  const sessionId = callerAgentId
    ? appState.agents.get(callerAgentId)?.sessionId
    : undefined;
  const session = sessionId ? appState.sessions.get(sessionId) : undefined;
  if (!session?.path || !session.repo_root) {
    return "user";
  }

  // The second test matters when no automation base is set: the two roots are
  // then the same path, and every session would look like automation traffic.
  return isInsideRoot(
    worktreesRoot(session.repo_root, "automation"),
    session.path,
  ) && !isInsideRoot(worktreesRoot(session.repo_root, "user"), session.path)
    ? "automation"
    : "user";
}
