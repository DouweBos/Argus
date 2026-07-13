import { BrowserWindow } from "electron";

/** Observer that also receives every broadcast (e.g. the remote gateway). */
export type BroadcastTap = (channel: string, args: unknown[]) => void;

const taps = new Set<BroadcastTap>();

/**
 * Register a tap that receives a copy of every renderer broadcast. Returns an
 * unsubscribe function. Taps must never throw — errors are swallowed so a
 * misbehaving observer can't break event delivery to the UI.
 */
export function addBroadcastTap(tap: BroadcastTap): () => void {
  taps.add(tap);

  return () => taps.delete(tap);
}

/**
 * Send an IPC event to every live renderer — the main window plus any popout
 * windows (simulator or agent). Used for events (agent streams, session
 * updates, etc.) that multiple windows subscribe to in parallel.
 */
export function broadcastToRenderers(
  channel: string,
  ...args: unknown[]
): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (win.isDestroyed()) {
      continue;
    }
    win.webContents.send(channel, ...args);
  }
  for (const tap of taps) {
    try {
      tap(channel, args);
    } catch {
      // A tap must not disrupt UI event delivery.
    }
  }
}
