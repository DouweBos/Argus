/**
 * Switching the runner bound to a single agent.
 *
 * The session's `runner_id` is only the default new agents inherit — each
 * agent then owns its runner, so one tab can run against a gateway while its
 * siblings stay on the built-in CLI. A switch is only allowed while that
 * agent has no conversation yet: the moment a prompt has been sent, its
 * transcript belongs to that runner's CLI and gateway.
 */

import { emitHostEvent } from "@argus/host/bus";
import { appState } from "../../state";
import { respawnAgent } from "../agent/agentService";
import { getRunnerById } from "./registry";

/**
 * Bind one agent to a different runner and restart its subprocess under the
 * new env. Resets the agent's model — model ids don't carry across runners,
 * a gateway rejects the other one's.
 */
export async function setAgentRunner(
  agentId: string,
  runnerId: string,
): Promise<void> {
  const agent = appState.agents.get(agentId);
  if (!agent) {
    throw `No agent found: ${agentId}`;
  }
  const runner = getRunnerById(runnerId);
  if (!runner) {
    throw `Unknown runner: ${runnerId}`;
  }
  if (agent.runner.id === runnerId) {
    return;
  }
  if (agent.turnsCompleted > 0 || agent.inflightPrompts > 0) {
    throw "The runner is fixed once the agent has started working — start a new agent to use a different runner";
  }

  agent.runner = runner;
  agent.model = runner.defaultModel?.() ?? null;

  emitHostEvent(`agent:runner-changed:${agentId}`, runnerId);

  // The live subprocess was spawned with the old runner's env; the restart
  // reuses the agent id so the tab survives.
  await respawnAgent(agentId);
}
