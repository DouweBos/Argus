import { appState } from "../../state";

/** Setup pipelines can install dependencies, so give them room. */
const SESSION_READY_TIMEOUT_MS = 15 * 60 * 1000;

/**
 * Resolve once a freshly-created session's worktree and setup pipeline are
 * done. Throws if it fails setup, is deleted, or never gets there.
 */
export async function waitForSessionReady(
  sessionId: string,
  timeoutMs = SESSION_READY_TIMEOUT_MS,
): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const session = appState.sessions.get(sessionId);
    if (!session) {
      throw `Session ${sessionId} was deleted before it became ready`;
    }
    if (session.status === "ready") {
      return;
    }
    if (typeof session.status !== "string") {
      throw `Session ${sessionId} failed to initialize: ${session.status.error}`;
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw `Timed out waiting for session ${sessionId} to become ready`;
}
