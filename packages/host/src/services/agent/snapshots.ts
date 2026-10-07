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

const parsed = new Map<string, { raw: string; value: unknown }>();

/**
 * The snapshot parsed, reused until a new one is published. A long transcript
 * is megabytes of JSON, and every status push and transcript page reads it.
 * Treat the result as read-only: it is shared between callers.
 */
export function getParsedAgentSnapshot<T>(agentId: string): T | null {
  const raw = appState.agentSnapshots.get(agentId);
  if (!raw) {
    parsed.delete(agentId);

    return null;
  }
  const cached = parsed.get(agentId);
  if (cached?.raw === raw) {
    return cached.value as T;
  }
  const value = JSON.parse(raw) as T;
  parsed.set(agentId, { raw, value });

  return value;
}
