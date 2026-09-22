/**
 * Sidebar width survives a reload — unlike the desktop there is no window state
 * to restore it from.
 */

const KEY = "argus.web.sidebarWidth";
const DEFAULT = 320;

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
