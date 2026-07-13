/**
 * Light/dark theming for the web client — mirrors the desktop's themeStore.
 * Toggles `data-theme` on <html>; Peacock's tokens key off it. Preference is
 * persisted in localStorage and "system" tracks `prefers-color-scheme`.
 */

import { create } from "zustand";

export type ThemePreference = "dark" | "light" | "system";
export type ResolvedTheme = "dark" | "light";

export const THEME_PREFERENCE_LABELS: Record<ThemePreference, string> = {
  system: "System",
  light: "Light",
  dark: "Dark",
};

const STORAGE_KEY = "argus.theme";

function readSystem(): ResolvedTheme {
  return window.matchMedia?.("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
}

function readPreference(): ThemePreference {
  const raw = localStorage.getItem(STORAGE_KEY);

  return raw === "light" || raw === "dark" || raw === "system" ? raw : "system";
}

interface ThemeState {
  preference: ThemePreference;
  systemResolved: ResolvedTheme;
}

const store = create<ThemeState>(() => ({
  preference: readPreference(),
  systemResolved: readSystem(),
}));

function resolve(state: ThemeState): ResolvedTheme {
  return state.preference === "system" ? state.systemResolved : state.preference;
}

function apply(theme: ResolvedTheme): void {
  document.documentElement.dataset.theme = theme;
  document.documentElement.style.colorScheme = theme;
}

export function setThemePreference(preference: ThemePreference): void {
  store.setState({ preference });
  try {
    localStorage.setItem(STORAGE_KEY, preference);
  } catch {
    // storage unavailable — session-only preference
  }
  apply(resolve(store.getState()));
}

export const useThemePreference = () => store((s) => s.preference);

export function getResolvedTheme(): ResolvedTheme {
  return resolve(store.getState());
}

export function initTheme(): void {
  apply(resolve(store.getState()));
  const media = window.matchMedia?.("(prefers-color-scheme: dark)");
  media?.addEventListener("change", (e) => {
    store.setState({ systemResolved: e.matches ? "dark" : "light" });
    apply(resolve(store.getState()));
  });
}
