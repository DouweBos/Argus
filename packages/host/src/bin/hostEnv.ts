/**
 * Process defaults for the standalone host. Imported first by `argus-host.ts`:
 * several modules read these at import time, so they must be in place before
 * anything else loads.
 *
 * Server mode (the default) keeps its state apart from both the desktop
 * (`~/.argus`) and Argus Server.app (`~/.argus-server`) — it keeps its secrets
 * in its own storage and must never share device keys with an Electron build.
 *
 * `--desktop` is the Mac app's bundled host: it *is* the desktop, so it runs on
 * the desktop's `~/.argus` and remote port, and the host lock keeps it from
 * ever sharing that directory with a running Electron app.
 */

import os from "node:os";
import path from "node:path";

export const desktopMode = process.argv.includes("--desktop");

if (!desktopMode) {
  process.env.ARGUS_SERVER = "1";
  process.env.ARGUS_HOME ||= path.join(os.homedir(), ".argus-host");
  process.env.ARGUS_REMOTE_PORT ||= "47617";
}
