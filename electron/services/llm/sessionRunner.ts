/**
 * Switching the runner bound to a session.
 *
 * The runner is stamped at create time and every agent inherits it, so a
 * switch is only allowed while the session has no conversation yet: the
 * moment a prompt has been sent, its transcript belongs to that runner's
 * CLI and gateway. Agents that are still message-free (prewarms, a freshly
 * started agent) are restarted so they run under the new runner's env.
 */

import { emitHostEvent } from "@argus/host/bus";
import { appState } from "../../state";
import { respawnAgent, stopAgent } from "../agent/agentService";
import { worktreesRoot } from "../session/git";
import { loadMetadata, saveMetadata } from "../session/metadata";
import { getRunnerById } from "./registry";

/** True while no agent in the session has sent or finished a prompt. */
function hasStartedConversation(sessionId: string): boolean {
  return [...appState.agents.values()].some(
    (a) =>
      a.sessionId === sessionId &&
      (a.turnsCompleted > 0 || a.inflightPrompts > 0),
  );
}

/**
 * Bind the session to a different runner. Resets the session's default model
 * to the new runner's — model ids don't carry across runners, a gateway
 * rejects the other one's.
 */
export async function setSessionRunner(
  sessionId: string,
  runnerId: string,
): Promise<void> {
  const session = appState.sessions.get(sessionId);
  if (!session) {
    throw `Session not found: ${sessionId}`;
  }
  const runner = getRunnerById(runnerId);
  if (!runner) {
    throw `Unknown runner: ${runnerId}`;
  }
  if ((session.runner_id ?? "claude-code") === runnerId) {
    return;
  }
  if (hasStartedConversation(sessionId)) {
    throw "The runner is fixed once the agent has started working — create a new session to use a different runner";
  }

  session.runner_id = runnerId;
  session.model = runner.defaultModel?.() ?? null;
  appState.sessions.set(sessionId, session);

  if (session.path) {
    const worktreesDir = worktreesRoot(session.repo_root);
    const meta = loadMetadata(worktreesDir);
    const m = meta.get(session.path);
    if (m) {
      m.runner_id = session.runner_id;
      m.model = session.model;
      meta.set(session.path, m);
      try {
        saveMetadata(worktreesDir, meta);
      } catch {
        // Non-fatal.
      }
    }
  }

  emitHostEvent("session:updated", {
    id: sessionId,
    runner_id: session.runner_id,
    model: session.model,
  });

  // Existing subprocesses were spawned with the old runner's env. Prewarms
  // are dropped (the renderer spawns a fresh one); a claimed but idle agent
  // is restarted in place so its tab survives.
  for (const agent of [...appState.agents.values()]) {
    if (agent.sessionId !== sessionId) {
      continue;
    }
    if (agent.prewarmed) {
      await stopAgent(agent.agentId).catch(() => {});
    } else {
      await respawnAgent(agent.agentId).catch(() => {});
    }
  }
}
