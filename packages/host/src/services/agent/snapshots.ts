/**
 * Cross-window conversation snapshots: the last serialised conversation a
 * window published for an agent, so another window can hydrate from it.
 */

import { appState } from "../../state";

/** Store an agent's snapshot; an empty one drops it. */
export function publishAgentSnapshot(
  agentId: string,
  snapshot: string | null | undefined,
): void {
  if (!agentId) {
    return;
  }
  if (!snapshot) {
    appState.agentSnapshots.delete(agentId);
  } else {
    appState.agentSnapshots.set(agentId, snapshot);
  }
}

export function getAgentSnapshot(agentId: string): string | null {
  return appState.agentSnapshots.get(agentId) ?? null;
}
