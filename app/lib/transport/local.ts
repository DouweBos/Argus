/** Today's transport: Electron IPC straight to the main process in this app. */

import type { ArgusTransport } from "./types";

export const localTransport: ArgusTransport = {
  invoke: (channel, args) => window.argus.invoke(channel, args),
  send: (channel, args) => {
    window.argus.send(channel, args);
  },
  on: (event, callback) => window.argus.on(event, callback),
};
