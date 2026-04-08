/**
 * Shell operations — wrappers around Electron's shell module for renderer access.
 */

import { shell } from "electron";

/** Open the system file manager with the given path selected. */
export function revealInFinder(fullPath: string): void {
  shell.showItemInFolder(fullPath);
}
