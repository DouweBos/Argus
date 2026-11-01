/**
 * Openers for screens whose path needs more than the caller has: an agent's
 * path carries its session, which a notification or a launch URL may not.
 */

import type { RemoteAgentStatus } from "../lib/protocol";
import { useAgentsStore } from "../stores/agents";
import { useProjectsStore } from "../stores/projects";
import { appNavigate, type NavigateOptions } from "./router";

export type AgentRef = Pick<RemoteAgentStatus, "agent_id" | "session_id">;

/** The session an agent belongs to, from whatever list already has it. */
export function sessionOfAgent(agentId: string): string | null {
  const known =
    useAgentsStore.getState().statusByAgent[agentId] ??
    useProjectsStore.getState().recentAgents.find((a) => a.agent_id === agentId) ??
    Object.values(useProjectsStore.getState().agentsByRepo)
      .flat()
      .find((a) => a.agent_id === agentId);

  return known?.session_id ?? null;
}

export function openAgent(agent: AgentRef, options?: NavigateOptions): void {
  appNavigate(
    { name: "agent", sessionId: agent.session_id, agentId: agent.agent_id },
    options,
  );
}

/** Open an agent known only by id, asking the computer for its session. */
export async function openAgentById(
  agentId: string,
  options?: NavigateOptions,
): Promise<void> {
  let sessionId = sessionOfAgent(agentId);
  if (!sessionId) {
    await useAgentsStore.getState().loadAgentStatus(agentId);
    sessionId = sessionOfAgent(agentId);
  }
  if (sessionId) {
    openAgent({ agent_id: agentId, session_id: sessionId }, options);
  }
}

/** The repo a session belongs to, once its project's sessions are loaded. */
export function repoOfSession(sessionId: string): string | null {
  for (const [repoRoot, sessions] of Object.entries(
    useProjectsStore.getState().sessionsByRepo,
  )) {
    if (sessions.some((s) => s.id === sessionId)) {
      return repoRoot;
    }
  }

  return null;
}
