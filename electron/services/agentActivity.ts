/**
 * Shared "is this agent doing work right now" predicate.
 *
 * Lives outside the tray because the server's update flow needs the exact same
 * answer — restarting for an update must not kill a running agent, and a second
 * definition would drift from the one the menu shows.
 */

import type { AgentSession } from "@argus/host/services/agent/models";
import { appState } from "@argus/host/state";

/**
 * The CLI's `session_state_changed` can flip to `idle` between tool calls
 * within the same turn, so process status alone understates activity — we also
 * count any in-flight prompt that hasn't emitted its final `result` event yet.
 * This mirrors the renderer's `inflight` tracking.
 */
export function isAgentActive(a: AgentSession): boolean {
  if (a.status === "stopped" || a.status === "error") {
    return false;
  }

  return (
    a.status === "running" ||
    a.status === "requires_action" ||
    a.inflightPrompts > 0
  );
}

/** How many agents are doing work right now. */
export function countActiveAgents(): number {
  let n = 0;
  for (const a of appState.agents.values()) {
    if (isAgentActive(a)) {
      n += 1;
    }
  }

  return n;
}
