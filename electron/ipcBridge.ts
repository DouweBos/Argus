/**
 * The Electron end of the command registry.
 *
 * `defineCommand` records a command; this binder is what turns each one into
 * an `ipcMain.handle` registration so the renderer can invoke it. A headless
 * host installs no binder — its only caller is the remote gateway, which
 * dispatches through the registry directly.
 */

import { ipcMain } from "electron";
import {
  type CommandArgs,
  dispatchCommand,
  setCommandBinder,
} from "@argus/host/services/command/registry";

export function installIpcCommandBridge(): void {
  setCommandBinder(({ name }) => {
    ipcMain.handle(name, (_event, args: CommandArgs = {}) =>
      dispatchCommand(name, args),
    );
  });
}
