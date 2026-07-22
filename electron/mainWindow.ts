/**
 * Side-effect-free holder for the main BrowserWindow reference. Services import
 * `getMainWindow` from here instead of `main.ts` so they don't drag the whole
 * Electron entry point (and its module-level `app.*` reads) into unit tests.
 */

import type { BrowserWindow } from "electron";

let mainWindow: BrowserWindow | null = null;

export function setMainWindow(window: BrowserWindow | null): void {
  mainWindow = window;
}

export function getMainWindow(): BrowserWindow | null {
  return mainWindow;
}
