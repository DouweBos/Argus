import type { AgentSession, AgentStatusValue } from "./models";

/** Everyone waiting on the agent's turn hears how it ended. */
export function settleTurnWaiters(
  agent: AgentSession,
  status: AgentStatusValue,
): void {
  for (const resolve of agent.turnWaiters ?? []) {
    resolve(status);
  }
  if (agent.turnWaiters) {
    agent.turnWaiters.length = 0;
  }
}

/** Whether `wait_for_agent` has an answer without waiting. */
export function hasAnswer(agent: AgentSession): boolean {
  return (
    agent.status === "stopped" ||
    agent.status === "error" ||
    // A send that never got through leaves a result without a turn.
    (agent.status === "idle" &&
      (agent.turnsCompleted > 0 || Boolean(agent.resultSummary)))
  );
}
