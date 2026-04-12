import { type UnlistenFn, listen } from "../lib/events";

/**
 * Singleton service that owns event subscriptions for terminal data.
 * Decouples the event subscription lifetime from React component lifetime,
 * enabling terminals to unmount/remount without losing output.
 */

type WriteFn = (data: Uint8Array) => void;

/** Active event listeners keyed by sessionId */
const listeners = new Map<string, UnlistenFn>();

/** Callbacks into mounted xterm instances */
const liveWriters = new Map<string, WriteFn>();

/** Buffered data received while no writer is attached */
const pendingChunks = new Map<string, Uint8Array[]>();

function decodePayload(payload: string): Uint8Array {
  try {
    return Uint8Array.from(atob(payload), (c) => c.charCodeAt(0));
  } catch {
    return new TextEncoder().encode(payload);
  }
}

/** Subscribe to terminal:data:{sessionId}. Route data to writer or buffer. */
export function startListening(sessionId: string): void {
  if (listeners.has(sessionId)) {
    return;
  }

  // Initialize pending buffer
  if (!pendingChunks.has(sessionId)) {
    pendingChunks.set(sessionId, []);
  }

  listen<string>(`terminal:data:${sessionId}`, (event) => {
    const bytes = decodePayload(event.payload);
    const writer = liveWriters.get(sessionId);
    if (writer) {
      writer(bytes);
    } else {
      const chunks = pendingChunks.get(sessionId);
      if (chunks) {
        chunks.push(bytes);
      } else {
        pendingChunks.set(sessionId, [bytes]);
      }
    }
  }).then((unlisten) => {
    // Guard against stopListening being called before the promise resolved
    if (!listeners.has(sessionId)) {
      unlisten();

      return;
    }

    listeners.set(sessionId, unlisten);
  });

  // Store a placeholder so we know we're listening
  listeners.set(sessionId, () => {});
}

/** Unsubscribe and clean up all state for a session (called on session destroy). */
export function stopListening(sessionId: string): void {
  const unlisten = listeners.get(sessionId);
  if (unlisten) {
    unlisten();
  }
  listeners.delete(sessionId);
  liveWriters.delete(sessionId);
  pendingChunks.delete(sessionId);
}

/** Register a live write callback (called when terminal mounts). */
export function attachWriter(sessionId: string, fn: WriteFn): void {
  liveWriters.set(sessionId, fn);
}

/** Unregister the write callback (called when terminal unmounts). */
export function detachWriter(sessionId: string): void {
  liveWriters.delete(sessionId);
}

/** Return and clear any buffered chunks received while no writer was attached. */
export function drainPending(sessionId: string): Uint8Array[] {
  const chunks = pendingChunks.get(sessionId);
  if (!chunks || chunks.length === 0) {
    return [];
  }
  const drained = [...chunks];
  chunks.length = 0;

  return drained;
}
