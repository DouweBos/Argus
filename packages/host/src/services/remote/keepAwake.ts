import { powerAssertion } from "../../lib/powerAssertion";
import { loadAppSettings } from "../appSettings/store";

/**
 * Closing the lid sleeps the Mac: agents then only get CPU during brief dark
 * wakes, long enough to push a notification but not to keep a phone's socket.
 * `-s` holds it awake on power, lid closed included; on battery it is ignored.
 */
const assertion = powerAssertion(["-s"]);

function keepAwakeEnabled(): boolean {
  return loadAppSettings().remote_keep_awake !== false;
}

/** Hold the assertion exactly while remote access runs and the setting is on. */
export function syncKeepAwake(remoteRunning: boolean): void {
  if (remoteRunning && keepAwakeEnabled()) {
    assertion.hold();
  } else {
    assertion.release();
  }
}
