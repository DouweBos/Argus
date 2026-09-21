/**
 * Fan-out hub for embedded-browser JPEG frames to non-renderer consumers (the
 * remote gateway). The desktop reads the same frames off the local MJPEG
 * server; this module lets an attached desktop pull them over the gateway's
 * binary media channel instead of a localhost URL it can't reach.
 *
 * Mirrors `simulator/videoForward.ts`. Keyed by browser session id. The last
 * frame is cached because CDP only emits on repaint — a viewer attaching to a
 * static page would otherwise stare at nothing until something moved.
 */

export type BrowserFrameListener = (
  jpeg: Uint8Array,
  timestamp: number,
) => void;

const listenersBySession = new Map<string, Set<BrowserFrameListener>>();
const lastFrameBySession = new Map<string, Uint8Array>();

/**
 * Subscribe to a session's frames. The last seen frame, if any, is delivered
 * synchronously so the viewer paints immediately. Returns an unsubscribe.
 */
export function onBrowserFrame(
  sessionId: string,
  listener: BrowserFrameListener,
): () => void {
  let set = listenersBySession.get(sessionId);
  if (!set) {
    set = new Set();
    listenersBySession.set(sessionId, set);
  }
  set.add(listener);

  const cached = lastFrameBySession.get(sessionId);
  if (cached) {
    listener(cached, Date.now());
  }

  return () => {
    const current = listenersBySession.get(sessionId);
    if (!current) {
      return;
    }
    current.delete(listener);
    if (current.size === 0) {
      listenersBySession.delete(sessionId);
    }
  };
}

export function emitBrowserFrame(sessionId: string, jpeg: Uint8Array): void {
  lastFrameBySession.set(sessionId, jpeg);
  const set = listenersBySession.get(sessionId);
  if (!set) {
    return;
  }
  const timestamp = Date.now();
  for (const listener of set) {
    listener(jpeg, timestamp);
  }
}

/** Drop the cached frame when a session's screencast ends. */
export function clearBrowserFrames(sessionId: string): void {
  lastFrameBySession.delete(sessionId);
}

/** Test seam: forget every listener and cached frame. */
export function resetBrowserFrames(): void {
  listenersBySession.clear();
  lastFrameBySession.clear();
}
