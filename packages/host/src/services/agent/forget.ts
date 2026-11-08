import { emitHostEvent } from "@argus/host/bus";
import { appState } from "../../state";
import { takeStagedConversation } from "./conversation/live";
import { forgetLimitResume } from "./limitResume";
import { clearQueue } from "./messageQueue";

/**
 * An agent leaves `appState.agents` for good: drop everything else keyed by it.
 * The `stopped` status is what releases its folded conversation, so every path
 * that removes an agent has to come through here.
 */
export function forgetAgent(agentId: string): void {
  appState.agents.delete(agentId);
  appState.agentPendingPermissions.delete(agentId);
  takeStagedConversation(agentId);
  clearQueue(agentId);
  forgetLimitResume(agentId);
  emitHostEvent(`agent:status:${agentId}`, "stopped");
}
