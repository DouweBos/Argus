/**
 * Pane widths survive a reload — unlike the desktop there is no window state
 * to restore them from.
 */

const KEY = "argus.web.sidebarWidth";
const DEFAULT = 320;
const DEVICE_KEY = "argus.web.huddleDeviceWidth";
const DEVICE_DEFAULT = 420;
const CHAT_KEY = "argus.web.huddleChatWidth";
const CHAT_DEFAULT = 320;

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

/** Width of the huddle's chat column on a wide screen. */
export function loadChatPanelWidth(): number {
  const raw = Number(localStorage.getItem(CHAT_KEY));

  return Number.isFinite(raw) && raw > 0 ? raw : CHAT_DEFAULT;
}

export function saveChatPanelWidth(width: number): void {
  try {
    localStorage.setItem(CHAT_KEY, String(Math.round(width)));
  } catch {
    // storage unavailable — session-only width
  }
}
