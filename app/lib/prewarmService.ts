import type { Session } from "./types";
import { getAgentsBySession, subscribeAgentStore } from "../stores/agentStore";
import {
  clearPrewarm,
  getPrewarmState,
  setPrewarmFailed,
  setPrewarmReady,
  startPrewarming,
} from "../stores/prewarmStore";
import { getSessionState, subscribeSessionStore } from "../stores/sessionStore";
import { discardPrewarmAgent, prewarmAgent } from "./ipc";
import { getCurrentRoute } from "./router";

/**
 * Eager Claude subprocess prewarming.
 *
 * Keeps at most one Claude subprocess warmed up — for the currently selected
 * session, when it's `ready` and has no agent yet. That's the only spot where
 * the warmup actually pays off: the StartAgentDialog gets real models +
 * slash commands without a spinner, and the first send skips the 1–3s
 * spawn handshake. Every other session can pay the spawn cost on demand
 * when the user navigates to it.
 *
 * Failed prewarms are not retried automatically — `startAgentInSession`
 * still works as a fallback when the user submits the dialog.
 */

const PREWARM_LOG_PREFIX = "[prewarm]";
const inFlight = new Set<string>();

function isReady(status: Session["status"]): boolean {
  return status === "ready";
}

async function prewarmFor(sessionId: string): Promise<void> {
  if (inFlight.has(sessionId)) {
    return;
  }
  inFlight.add(sessionId);
  startPrewarming(sessionId);
  try {
    const info = await prewarmAgent(sessionId);
    setPrewarmReady(sessionId, {
      agentId: info.agent_id,
      capabilities: info.capabilities ?? null,
    });
  } catch (err) {
    setPrewarmFailed(sessionId);
    // eslint-disable-next-line no-console
    console.warn(
      `${PREWARM_LOG_PREFIX} session=${sessionId} failed:`,
      err instanceof Error ? err.message : String(err),
    );
  } finally {
    inFlight.delete(sessionId);
  }
}

function discardSlot(sessionId: string): void {
  const slot = getPrewarmState().slots[sessionId];
  if (!slot) {
    return;
  }
  if (slot.agentId) {
    discardPrewarmAgent(slot.agentId).catch(() => {});
  }
  clearPrewarm(sessionId);
}

function shouldPrewarm(sessionId: string): boolean {
  const session = getSessionState().sessions.find((s) => s.id === sessionId);
  if (!session || !isReady(session.status)) {
    return false;
  }
  // Skip if a real (non-prewarmed) agent is already attached. Prewarmed
  // agents never enter the renderer's agentStore — they're only registered
  // via the prewarm slot — so any agent here means the dialog is gone.
  if (getAgentsBySession(sessionId).length > 0) {
    return false;
  }

  return true;
}

function reconcile(): void {
  const target = getCurrentRoute().sessionId;
  const slots = getPrewarmState().slots;

  // Tear down every slot that isn't the current target.
  for (const id of Object.keys(slots)) {
    if (id !== target) {
      discardSlot(id);
    }
  }

  if (!target || !shouldPrewarm(target)) {
    if (target && slots[target]) {
      discardSlot(target);
    }

    return;
  }

  if (slots[target] || inFlight.has(target)) {
    return;
  }
  prewarmFor(target).catch(() => {});
}

/**
 * Drop and re-spawn the slot after something invalidated it (a runner switch
 * changes the subprocess env, so the warmed child is no longer the right one).
 */
export function refreshPrewarm(sessionId: string): void {
  discardSlot(sessionId);
  if (shouldPrewarm(sessionId)) {
    prewarmFor(sessionId).catch(() => {});
  }
}

export function initPrewarm(): () => void {
  reconcile();

  const unsubSessions = subscribeSessionStore(reconcile);
  const unsubAgents = subscribeAgentStore(reconcile);
  const handleRouteChange = () => reconcile();
  window.addEventListener("router:historychange", handleRouteChange);

  // Best-effort cleanup on window unload — kills any unclaimed Claude
  // processes so they don't linger after a refresh / quit.
  const handleUnload = () => {
    const slots = getPrewarmState().slots;
    for (const slot of Object.values(slots)) {
      if (slot.agentId && slot.status === "ready") {
        // Fire-and-forget; the page is going away.
        discardPrewarmAgent(slot.agentId).catch(() => {});
      }
    }
  };
  window.addEventListener("beforeunload", handleUnload);

  return () => {
    unsubSessions();
    unsubAgents();
    window.removeEventListener("router:historychange", handleRouteChange);
    window.removeEventListener("beforeunload", handleUnload);
  };
}
