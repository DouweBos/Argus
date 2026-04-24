import { BrowserWindow } from "electron";

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
}
