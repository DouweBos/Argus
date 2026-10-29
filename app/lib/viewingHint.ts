import { sessionHostId } from "../stores/sessionStore";
import { onHost, setViewingSession } from "./ipc";
import { getCurrentRoute } from "./router";

/**
 * Tells the host which session this window shows, so it keeps a warm agent
 * there. Which sessions stay warm, and who gets the spare, is the host's call.
 */

/** Names this window to the host, which has no connection to key it on. */
const viewerId = crypto.randomUUID();
/** Start composers' runner picks, so the spare is warmed under the right one. */
const composerRunners = new Map<string, string>();
let sent: { runnerId: string | null; sessionId: string | null } | null = null;

function sendHint(): void {
  const sessionId = getCurrentRoute().sessionId ?? null;
  const runnerId = sessionId ? (composerRunners.get(sessionId) ?? null) : null;
  if (sent?.sessionId === sessionId && sent.runnerId === runnerId) {
    return;
  }
  const left = sent?.sessionId;
  sent = { sessionId, runnerId };
  // A hint goes to the session's own machine; the one we left keeps ours otherwise.
  if (left && left !== sessionId) {
    const leftHost = sessionHostId(left);
    if (!sessionId || sessionHostId(sessionId) !== leftHost) {
      onHost(leftHost, () => setViewingSession(null, viewerId)).catch(() => {});
    }
  }
  if (sessionId) {
    setViewingSession(sessionId, viewerId, runnerId).catch(() => {});
  }
}

/** The start composer picked a runner other than the session's; null clears it. */
export function setComposerRunner(
  sessionId: string,
  runnerId: string | null,
): void {
  if (runnerId) {
    composerRunners.set(sessionId, runnerId);
  } else {
    composerRunners.delete(sessionId);
  }
  sendHint();
}

export function initViewingHint(): () => void {
  sendHint();
  const handleUnload = () => {
    const left = sent?.sessionId;
    if (left) {
      onHost(sessionHostId(left), () =>
        setViewingSession(null, viewerId),
      ).catch(() => {});
    }
  };
  window.addEventListener("router:historychange", sendHint);
  window.addEventListener("beforeunload", handleUnload);

  return () => {
    window.removeEventListener("router:historychange", sendHint);
    window.removeEventListener("beforeunload", handleUnload);
  };
}
