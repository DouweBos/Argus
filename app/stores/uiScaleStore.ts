import { create } from "zustand";
import { mirrorToHost } from "../lib/hostPrefs";

export type UiScale = "default" | "large" | "larger" | "small" | "smaller";

/**
 * Multipliers tuned to match macOS-style "Larger Text / … / More Space" pacing.
 * `default` is bumped above 1.0 because the previous unscaled UI was widely
 * reported as too small — `small` (1.0) preserves the original look for users
 * who liked it.
 */
export const UI_SCALE_FACTORS: Record<UiScale, number> = {
  larger: 1.25,
  large: 1.15,
  default: 1.08,
  small: 1.0,
  smaller: 0.92,
};

export const UI_SCALE_LABELS: Record<UiScale, string> = {
  larger: "Larger Text",
  large: "Large",
  default: "Default",
  small: "Small",
  smaller: "More Space",
};

/** Order matches the macOS Display Settings slider — large on the left. */
export const UI_SCALE_ORDER: UiScale[] = [
  "larger",
  "large",
  "default",
  "small",
  "smaller",
];

interface UiScaleState {
  scale: UiScale;
}

const STORAGE_KEY = "argus:ui-scale";

function load(): UiScaleState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (
      raw === "larger" ||
      raw === "large" ||
      raw === "default" ||
      raw === "small" ||
      raw === "smaller"
    ) {
      return { scale: raw };
    }
  } catch {
    // storage unavailable
  }

  return { scale: "default" };
}

const store = create<UiScaleState>(() => load());

function apply(scale: UiScale) {
  if (typeof window === "undefined") {
    return;
  }
  // Use Electron's `webFrame.setZoomFactor` (exposed via preload) rather than
  // CSS `zoom`. CSS zoom scales rendered output but leaves the viewport size
  // unchanged, so `vw`/`vh`-based layouts (settings dialog, full-screen
  // overlays) overflow at >1.0. webFrame zoom scales the viewport too —
  // dialogs, media queries, and intrinsic widths all stay correct.
  const factor = UI_SCALE_FACTORS[scale];
  window.argus?.setZoomFactor?.(factor);
}

export function setUiScale(scale: UiScale) {
  store.setState({ scale });
  try {
    localStorage.setItem(STORAGE_KEY, scale);
    mirrorToHost(STORAGE_KEY);
  } catch {
    // storage unavailable
  }
  apply(scale);
}

export const useUiScale = () => store((s) => s.scale);
export const getUiScale = () => store.getState().scale;

export function initUiScale() {
  apply(store.getState().scale);
}
