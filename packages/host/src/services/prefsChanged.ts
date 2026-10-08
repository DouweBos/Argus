/**
 * `prefs:changed` — app settings or UI state were written. Two windows can be
 * on one host (Electron plus an attached Argus for Mac), so each refetches the
 * keys named here instead of trusting the copy it read at boot.
 */

import { emitHostEvent } from "@argus/host/bus";

export const PREFS_CHANGED = "prefs:changed";

export interface PrefsChange {
  /** `AppSettings` keys written. */
  settings?: string[];
  /** `ui_state_set` keys written. */
  ui_state?: string[];
}

export function emitPrefsChanged(change: PrefsChange): void {
  emitHostEvent(PREFS_CHANGED, change);
}
