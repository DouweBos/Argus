/**
 * Serve the local UI socket for whichever app runs this host, and advertise it
 * in `host.lock` so a second window (Argus for Mac next to Electron, a dev
 * build next to either) attaches as a viewer instead of being turned away.
 */

import { LOCAL_UI_PROTOCOL } from "@argus/remote-protocol";
import path from "node:path";
import { argusHomeDir } from "../../lib/argusHome";
import { advertiseHostSocket } from "../../lib/hostLock";
import { hostPlatform, setHostPlatform } from "../../platform";
import { startLocalUiSocket, type LocalUiServer } from "./localUiSocket";
import { uiHostPlatform } from "./uiHostPlatform";

export function defaultUiSocketPath(): string {
  return path.join(argusHomeDir(), "host.sock");
}

/**
 * Listen, wrap the installed platform so attached UIs get their share of it
 * (see `uiHostPlatform`), then advertise. Install the base platform first.
 */
export async function serveLocalUi(
  options: { socketPath?: string; supervised?: boolean } = {},
): Promise<LocalUiServer> {
  const socketPath = options.socketPath ?? defaultUiSocketPath();
  const server = await startLocalUiSocket(socketPath);
  setHostPlatform(
    uiHostPlatform(server.channel, hostPlatform(), {
      supervised: options.supervised,
    }),
  );
  advertiseHostSocket(socketPath, LOCAL_UI_PROTOCOL);

  return server;
}
