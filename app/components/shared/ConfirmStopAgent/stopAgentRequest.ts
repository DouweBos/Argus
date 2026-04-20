import { stopAgentById } from "../../../lib/agentEventService";
import { getAgentState } from "../../../stores/agentStore";

export type Pending = {
  agentId: string;
  onAfterStop: (() => void) | null;
} | null;

let pending: Pending = null;
const listeners = new Set<() => void>();

export function getPending(): Pending {
  return pending;
}

export function subscribe(fn: () => void): () => void {
  listeners.add(fn);

  return () => {
    listeners.delete(fn);
  };
}

export function setPending(next: Pending): void {
  pending = next;
  listeners.forEach((fn) => fn());
}

/**
 * Request that an agent be stopped. If its current status is `running`, a
 * confirmation dialog is shown (rendered by `StopAgentGuard`); otherwise
 * the agent is stopped immediately.
 *
 * `onAfterStop` is invoked only after the stop actually happens (either the
 * immediate path or after the user confirms). It is NOT called if the user
 * cancels.
 */
export function requestStopAgent(
  agentId: string,
  onAfterStop?: () => void,
): void {
  const agent = getAgentState().agents[agentId];
  if (agent?.status === "running") {
    setPending({ agentId, onAfterStop: onAfterStop ?? null });

    return;
  }
  stopAgentById(agentId)
    .catch(() => {})
    .finally(() => onAfterStop?.());
}
