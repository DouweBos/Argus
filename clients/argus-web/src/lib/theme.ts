/**
 * Theming for the web client — mirrors the desktop's theme and colour theme
 * stores. Toggles `data-theme` and `data-color-theme` on <html>; Peacock's
 * tokens key off both. Preferences persist in localStorage and "system"
 * tracks `prefers-color-scheme`.
 */

import { create } from "zustand";
import {
  type ColorThemeId,
  DEFAULT_COLOR_THEME,
  isColorThemeId,
} from "@argus/peacock";

export type ThemePreference = "dark" | "light" | "system";
export type ResolvedTheme = "dark" | "light";

const STORAGE_KEY = "argus.theme";
const COLOR_THEME_KEY = "argus.colorTheme";

function readSystem(): ResolvedTheme {
  return window.matchMedia?.("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
}

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // storage unavailable — session-only preference
  }
}

function readPreference(): ThemePreference {
  const raw = read(STORAGE_KEY);

  return raw === "light" || raw === "dark" || raw === "system" ? raw : "system";
}

function readColorTheme(): ColorThemeId {
  const raw = read(COLOR_THEME_KEY);

  return isColorThemeId(raw) ? raw : DEFAULT_COLOR_THEME;
}

interface ThemeState {
  preference: ThemePreference;
  systemResolved: ResolvedTheme;
  colorTheme: ColorThemeId;
}

const store = create<ThemeState>(() => ({
  preference: readPreference(),
  systemResolved: readSystem(),
  colorTheme: readColorTheme(),
}));

function resolve(state: ThemeState): ResolvedTheme {
  return state.preference === "system" ? state.systemResolved : state.preference;
}

function apply(state: ThemeState): void {
  const theme = resolve(state);
  document.documentElement.dataset.theme = theme;
  document.documentElement.dataset.colorTheme = state.colorTheme;
  document.documentElement.style.colorScheme = theme;
}

export function setThemePreference(preference: ThemePreference): void {
  store.setState({ preference });
  write(STORAGE_KEY, preference);
  apply(store.getState());
}

export function setColorTheme(colorTheme: ColorThemeId): void {
  store.setState({ colorTheme });
  write(COLOR_THEME_KEY, colorTheme);
  apply(store.getState());
}

export const useThemePreference = () => store((s) => s.preference);

export const useColorTheme = () => store((s) => s.colorTheme);

export function getResolvedTheme(): ResolvedTheme {
  return resolve(store.getState());
}

export function initTheme(): void {
  apply(store.getState());
  const media = window.matchMedia?.("(prefers-color-scheme: dark)");
  media?.addEventListener("change", (e) => {
    store.setState({ systemResolved: e.matches ? "dark" : "light" });
    apply(store.getState());
  });
}
