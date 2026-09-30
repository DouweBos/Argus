/**
 * Process defaults for the standalone host. Imported first by `argus-host.ts`:
 * several modules read these at import time, so they must be in place before
 * anything else loads.
 *
 * State lives apart from both the desktop (`~/.argus`) and Argus Server.app
 * (`~/.argus-server`) — the Node host keeps its secrets in its own storage and
 * must never share device keys with an Electron build.
 */

import os from "node:os";
import path from "node:path";

process.env.ARGUS_SERVER = "1";
process.env.ARGUS_HOME ||= path.join(os.homedir(), ".argus-host");
process.env.ARGUS_REMOTE_PORT ||= "47617";
