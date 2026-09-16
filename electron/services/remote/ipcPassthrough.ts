/**
 * Raw IPC passthrough for admin-granted devices.
 *
 * An admin device is another Argus desktop driving this host, so it calls the
 * same `ipcMain.handle` commands the local renderer does rather than a second
 * hand-written allowlist. Electron keeps those handlers in a private map on
 * `ipcMain`; reading it avoids maintaining a parallel registry that could drift
 * from `ipc.ts` (and silently answer a command the renderer no longer has).
 */

import { ipcMain } from "electron";

type InvokeHandler = (event: unknown, args: unknown) => unknown;

interface IpcMainInternals {
  _invokeHandlers?: Map<string, InvokeHandler>;
}

/** The raw handler registered for a command, or null when there is none. */
export function findHostCommand(command: string): InvokeHandler | null {
  const handlers = (ipcMain as unknown as IpcMainInternals)._invokeHandlers;

  return handlers?.get(command) ?? null;
}

/** Whether a command name is a live `ipcMain.handle` registration. */
export function hasHostCommand(command: string): boolean {
  return findHostCommand(command) !== null;
}

/**
 * Invoke a host IPC command. The registered handlers ignore the event argument
 * (they only unwrap the args object), so a null-sender stand-in is enough.
 */
export async function invokeHostCommand(
  command: string,
  args: unknown,
): Promise<unknown> {
  const handler = findHostCommand(command);
  if (!handler) {
    throw new Error(`unknown command ${command}`);
  }

  return await handler({ sender: null, senderFrame: null }, args ?? {});
}
