import type { AgentSession } from "./models";
import { appState } from "../../state";

/** Mid-turn, waiting on a prompt or a permission answer. */
export function isAgentBusy(agent: AgentSession): boolean {
  return (
    agent.status === "running" ||
    agent.status === "requires_action" ||
    agent.inflightPrompts > 0 ||
    (appState.agentPendingPermissions.get(agent.agentId)?.size ?? 0) > 0
  );
}
