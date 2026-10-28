import { useEffect } from "react";
import { create } from "zustand";
import {
  type ColorThemeId,
  DEFAULT_COLOR_THEME,
  isColorThemeId,
} from "@argus/peacock";
import { mirrorToHost, onHostPrefChange } from "../lib/hostPrefs";

const STORAGE_KEY = "argus:color-theme";

function load(): ColorThemeId {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (isColorThemeId(raw)) {
      return raw;
    }
  } catch {
    // storage unavailable
  }

  return DEFAULT_COLOR_THEME;
}

const store = create<{ theme: ColorThemeId }>(() => ({ theme: load() }));

function apply(theme: ColorThemeId) {
  if (typeof document === "undefined") {
    return;
  }
  document.documentElement.dataset.colorTheme = theme;
}

onHostPrefChange(STORAGE_KEY, () => {
  store.setState({ theme: load() });
  apply(store.getState().theme);
});

export function setColorTheme(theme: ColorThemeId) {
  store.setState({ theme });
  try {
    localStorage.setItem(STORAGE_KEY, theme);
    mirrorToHost(STORAGE_KEY);
  } catch {
    // storage unavailable
  }
  apply(theme);
}

export const useColorTheme = () => store((s) => s.theme);

export function initColorTheme() {
  apply(store.getState().theme);
}

/** Show `theme` while the calling screen is mounted, without changing the user's pick. */
export function useColorThemeOverride(theme: ColorThemeId) {
  useEffect(() => {
    apply(theme);

    return () => apply(store.getState().theme);
  }, [theme]);
}
