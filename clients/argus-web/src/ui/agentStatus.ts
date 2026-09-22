/** Status and label mappings shared by the project and session views. */

import type { AgentStatus } from "@argus/peacock";
import type { RemoteAgentStatus } from "../lib/protocol";

export function mapAgentStatus(status: string): AgentStatus {
  switch (status) {
    case "running":
      return "running";
    case "requires_action":
      return "pending";
    case "error":
      return "error";
    case "stopped":
      return "done";
    default:
      return "idle";
  }
}

/**
 * What the agent needs from you — derived on the computer, so an agent that
 * looks idle still reads as blocked on an answer.
 */
export function agentAwaitingLabel(a: RemoteAgentStatus): string | null {
  switch (a.awaiting) {
    case "permission":
      return "needs approval";
    case "question":
      return "answer needed";
    case "plan":
      return "review plan";
    default:
      return null;
  }
}

export function agentMetaLabel(status: string): string {
  switch (status) {
    case "running":
      return "running";
    case "requires_action":
      return "needs input";
    case "error":
      return "blocked";
    case "stopped":
      return "done";
    default:
      return "idle";
  }
}
