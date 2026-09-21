/**
 * The Electron end of the host event bus.
 *
 * Services emit on `@argus/host`'s transport-agnostic bus; this is the sink
 * that turns those events into `webContents.send` for every live renderer —
 * the main window plus any popout (simulator or agent) window. The remote
 * gateway registers its own sink alongside this one, so a headless host with
 * no window still fans events out to paired devices.
 */

import { BrowserWindow } from "electron";
import { addHostEventSink } from "@argus/host/bus";

/**
 * Start forwarding host events to renderers. Returns an unsubscribe function.
 * Called once from `main.ts`, before any service can emit.
 */
export function installRendererEventSink(): () => void {
  return addHostEventSink((channel, args) => {
    for (const win of BrowserWindow.getAllWindows()) {
      if (win.isDestroyed()) {
        continue;
      }
      win.webContents.send(channel, ...args);
    }
  });
}
