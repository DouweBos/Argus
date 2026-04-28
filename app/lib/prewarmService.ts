import type { Session } from "./types";
import {
  clearPrewarm,
  getPrewarmState,
  setPrewarmFailed,
  setPrewarmReady,
  startPrewarming,
} from "../stores/prewarmStore";
import { getSessionState, subscribeSessionStore } from "../stores/sessionStore";
import { discardPrewarmAgent, prewarmAgent } from "./ipc";

/**
 * Eager Claude subprocess prewarming.
 *
 * For every session that reaches `ready`, fire off one `prewarm_agent` call
 * so the dialog has real models + slash commands ahead of time and the
 * "send" path skips the 1–3s spawn handshake. Sessions that disappear or
 * fail get their slot torn down.
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

function reconcile() {
  const { sessions } = getSessionState();
  const slots = getPrewarmState().slots;

  const aliveIds = new Set<string>();
  for (const session of sessions) {
    aliveIds.add(session.id);
    if (!isReady(session.status)) {
      continue;
    }
    if (slots[session.id] || inFlight.has(session.id)) {
      continue;
    }
    prewarmFor(session.id).catch(() => {});
  }

  // Tear down slots for sessions that are gone.
  for (const id of Object.keys(slots)) {
    if (!aliveIds.has(id)) {
      const slot = slots[id];
      if (slot.agentId) {
        discardPrewarmAgent(slot.agentId).catch(() => {});
      }
      clearPrewarm(id);
    }
  }
}

export function initPrewarm(): () => void {
  // Run once for any sessions already loaded at startup.
  reconcile();

  const unsubSessions = subscribeSessionStore(reconcile);

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
    window.removeEventListener("beforeunload", handleUnload);
  };
}
