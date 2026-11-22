import type { AgentSession } from "./models";
import { liveConversation } from "./conversation/live";

/** What `--resume` needs to bring the agent's conversation back; null without one. */
export function resumeRefOf(agent: AgentSession): string | null {
  return agent.resumeRef === undefined
    ? (liveConversation(agent.agentId)?.sessionId ?? null)
    : agent.resumeRef;
}

/** A conversation a respawn must not lose: one it resumed, or turns of its own. */
export function hasHistory(agent: AgentSession): boolean {
  return (
    agent.resumeRef !== null &&
    (agent.resumed === true || agent.turnsCompleted > 0)
  );
}
