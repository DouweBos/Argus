/**
 * Shell operations — wrappers around Electron's shell module for renderer access.
 */

import { shell } from "electron";

/** Open the system file manager with the given path selected. */
export function revealInFinder(fullPath: string): void {
  shell.showItemInFolder(fullPath);
}

/** Open an http/https URL in the user's default browser. */
export function openExternalUrl(url: string): void {
  if (!/^https?:\/\//i.test(url)) {
    throw `Refusing to open non-http(s) URL: ${url}`;
  }
  shell.openExternal(url).catch(() => undefined);
}
