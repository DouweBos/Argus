/**
 * Process defaults for the standalone host. Imported first by `argus-host.ts`:
 * several modules read these at import time, so they must be in place before
 * anything else loads.
 *
 * The CLI keeps its state apart from both the desktop (`~/.argus`) and Argus
 * Server (`~/.argus-server`) — it keeps its secrets in its own storage and must
 * never share device keys with an Electron build.
 *
 * `--desktop` is the Mac app's bundled host: it *is* the desktop, so it runs on
 * the desktop's `~/.argus` and remote port, and the host lock keeps it from
 * ever sharing that directory with a running Electron app. `--server` is the
 * native Argus Server's host, on `~/.argus-server`.
 */

import os from "node:os";
import { hostModeBehaviour, hostModeEnv, parseHostMode } from "./hostMode";

export const hostMode = parseHostMode(process.argv);
export const hostBehaviour = hostModeBehaviour(hostMode);

Object.assign(process.env, hostModeEnv(hostMode, process.env, os.homedir()));
