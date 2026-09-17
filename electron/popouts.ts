/**
 * Popout window bookkeeping.
 *
 * Floating device and agent windows are pure Electron concerns — a headless
 * host has none — so they live here rather than in the host's `AppState`.
 */

import type { BrowserWindow } from "electron";

/**
 * Floating always-on-top device popout windows, keyed by `platform:deviceKey`
 * — a UDID and an Android serial can collide, and video inputs have neither.
 */
export const devicePopouts = new Map<string, BrowserWindow>();

/**
 * Agent popout windows (dragged out of the tab bar), keyed by the agent_id
 * they display. While an entry exists, the tab bar in the main window hides
 * that agent.
 */
export const agentPopouts = new Map<string, BrowserWindow>();

/** Close a device popout by its `platform:deviceKey`, if one is open. */
export function closeDevicePopout(key: string): void {
  const win = devicePopouts.get(key);
  if (win && !win.isDestroyed()) {
    win.close();
  }
}
