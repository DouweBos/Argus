/**
 * Headless server mode.
 *
 * Argus Server runs the entire service layer with no window, so a Mac mini can
 * run agents and simulators 24/7 while laptops attach and detach over the
 * remote gateway.
 *
 * Mode is decided by `ARGUS_SERVER=1`, set before any module reads
 * `ARGUS_HOME` or `ARGUS_REMOTE_PORT` at import time (see `bin/hostMode.ts`).
 *
 * Leaf-level on purpose — node builtins and `lib/powerAssertion` only — so
 * `lib/argusHome.ts` can depend on it without pulling the service layer into
 * unit tests.
 */

import { powerAssertion } from "./lib/powerAssertion";

/** Whether this process is the headless server rather than the desktop app. */
export function isServerMode(): boolean {
  return process.env.ARGUS_SERVER === "1";
}

/**
 * Held for as long as the server runs: a sleeping mini stops agents mid-run
 * and drops every attached client.
 */
const serverAssertion = powerAssertion(["-i", "-m", "-s"]);

export function startPowerAssertion(): void {
  serverAssertion.hold();
}

export function stopPowerAssertion(): void {
  serverAssertion.release();
}
