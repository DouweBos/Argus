import { emitHostEvent } from "@argus/host/bus";
import { appState } from "../../state";
import { removeAgentTmpDir } from "./agentTmp";
import { takeStagedConversation } from "./conversation/live";
import { abandonAgent } from "./lifecycle";
import { forgetLimitResume } from "./limitResume";
import { forgetMcpControl } from "./mcpControl";
import { clearQueue } from "./messageQueue";

/**
 * An agent leaves `appState.agents` for good: drop everything else keyed by it.
 * The `stopped` status is what releases its folded conversation, so every path
 * that removes an agent has to come through here.
 */
export function forgetAgent(agentId: string): void {
  abandonAgent(agentId, appState.agents.get(agentId));
  appState.agents.delete(agentId);
  appState.agentPendingPermissions.delete(agentId);
  takeStagedConversation(agentId);
  clearQueue(agentId);
  forgetLimitResume(agentId);
  forgetMcpControl(agentId);
  removeAgentTmpDir(agentId).catch(() => undefined);
  emitHostEvent(`agent:status:${agentId}`, "stopped");
}
