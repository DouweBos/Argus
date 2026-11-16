/**
 * Pane widths survive a reload — unlike the desktop there is no window state
 * to restore them from.
 */

const KEY = "argus.web.sidebarWidth";
const DEFAULT = 272;
// The device's width key: it was the wider of the two panels this replaced.
const PANEL_KEY = "argus.web.huddleDeviceWidth";
const PANEL_DEFAULT = 420;

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

/** Width of the huddle's side panel (device and chat tabs) on a wide screen. */
export function loadSidePanelWidth(): number {
  const raw = Number(localStorage.getItem(PANEL_KEY));

  return Number.isFinite(raw) && raw > 0 ? raw : PANEL_DEFAULT;
}

export function saveSidePanelWidth(width: number): void {
  try {
    localStorage.setItem(PANEL_KEY, String(Math.round(width)));
  } catch {
    // storage unavailable — session-only width
  }
}
