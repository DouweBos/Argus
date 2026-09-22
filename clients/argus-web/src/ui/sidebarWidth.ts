/**
 * Pane widths survive a reload — unlike the desktop there is no window state
 * to restore them from.
 */

const KEY = "argus.web.sidebarWidth";
const DEFAULT = 320;
const DEVICE_KEY = "argus.web.huddleDeviceWidth";
const DEVICE_DEFAULT = 420;

export function loadSidebarWidth(): number {
  const raw = Number(localStorage.getItem(KEY));

  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT;
}

export function saveSidebarWidth(width: number): void {
  try {
    localStorage.setItem(KEY, String(Math.round(width)));
  } catch {
    // storage unavailable — session-only width
  }
}

/** Width of the huddle's device panel on a wide screen. */
export function loadDevicePanelWidth(): number {
  const raw = Number(localStorage.getItem(DEVICE_KEY));

  return Number.isFinite(raw) && raw > 0 ? raw : DEVICE_DEFAULT;
}

export function saveDevicePanelWidth(width: number): void {
  try {
    localStorage.setItem(DEVICE_KEY, String(Math.round(width)));
  } catch {
    // storage unavailable — session-only width
  }
}
