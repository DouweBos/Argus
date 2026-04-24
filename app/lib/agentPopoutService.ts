import {
  markAgentPoppedOut,
  seedPoppedOutAgents,
  unmarkAgentPoppedOut,
} from "../stores/agentStore";
import { listen } from "./events";
import { listPoppedOutAgents } from "./ipc";

/**
 * Keep the `poppedOut` slice of the agent store in sync with the backend's
 * authoritative `appState.agentPopouts` map.
 *
 * The backend is the source of truth — it broadcasts `agent:popout-opened`
 * when a window opens (regardless of which renderer triggered it) and
 * `agent:popout-closed` when a window is destroyed. On startup we seed the
 * current set so a reloaded renderer reflects any popouts that were opened
 * before it mounted.
 */
export async function initAgentPopoutSync(): Promise<void> {
  try {
    const ids = await listPoppedOutAgents();
    seedPoppedOutAgents(ids);
  } catch {
    // Ignore — store stays empty.
  }

  listen<{ agentId: string; sessionId: string }>(
    "agent:popout-opened",
    ({ payload }) => {
      markAgentPoppedOut(payload.agentId);
    },
  );

  listen<{ agentId: string }>("agent:popout-closed", ({ payload }) => {
    unmarkAgentPoppedOut(payload.agentId);
  });
}
