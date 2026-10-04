/**
 * Which client connection a request is running for, and what to undo when that
 * connection goes away. The gateway (and the local UI socket, which shares its
 * connection class) runs each request inside its connection's scope; a handler
 * that starts something a dropped client can no longer stop registers a
 * cleanup here.
 */

import { AsyncLocalStorage } from "node:async_hooks";

const current = new AsyncLocalStorage<string>();
const cleanups = new Map<string, Set<() => void>>();

export function runInConnection<T>(connectionId: string, fn: () => T): T {
  return current.run(connectionId, fn);
}

/** Null for a request that came over local IPC. */
export function currentConnectionId(): string | null {
  return current.getStore() ?? null;
}

/**
 * Run `cleanup` if the current request's connection closes first. Returns the
 * unregister call for when the work ends on its own; a no-op outside a
 * connection, where nothing can drop.
 */
export function onConnectionClose(cleanup: () => void): () => void {
  const connectionId = currentConnectionId();
  if (!connectionId) {
    return () => undefined;
  }
  let set = cleanups.get(connectionId);
  if (!set) {
    set = new Set();
    cleanups.set(connectionId, set);
  }
  set.add(cleanup);

  return () => {
    set.delete(cleanup);
    if (set.size === 0 && cleanups.get(connectionId) === set) {
      cleanups.delete(connectionId);
    }
  };
}

/** The connection is gone: run everything it left behind. */
export function closeConnection(connectionId: string): void {
  const set = cleanups.get(connectionId);
  cleanups.delete(connectionId);
  for (const cleanup of set ?? []) {
    try {
      cleanup();
    } catch {
      // One failed cleanup must not keep the rest from running.
    }
  }
}
