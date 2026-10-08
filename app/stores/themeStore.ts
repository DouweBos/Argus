import { create } from "zustand";
import { mirrorToHost, onHostPrefChange } from "../lib/hostPrefs";

export type ThemePreference = "dark" | "light" | "system";
export type ResolvedTheme = "dark" | "light";

export const THEME_PREFERENCE_LABELS: Record<ThemePreference, string> = {
  system: "Match system",
  light: "Light",
  dark: "Dark",
};

interface ThemeState {
  preference: ThemePreference;
  systemResolved: ResolvedTheme;
}

const STORAGE_KEY = "argus:theme";

function readSystem(): ResolvedTheme {
  if (typeof window === "undefined" || !window.matchMedia) {
    return "dark";
  }

  return window.matchMedia("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
}

function load(): ThemeState {
  let preference: ThemePreference = "system";
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw === "light" || raw === "dark" || raw === "system") {
      preference = raw;
    }
  } catch {
    // storage unavailable
  }

  return { preference, systemResolved: readSystem() };
}

const store = create<ThemeState>(() => load());

function resolve(state: ThemeState): ResolvedTheme {
  if (state.preference !== "system") {
    return state.preference;
  }

  return state.systemResolved;
}

function apply(theme: ResolvedTheme) {
  if (typeof document === "undefined") {
    return;
  }
  document.documentElement.dataset.theme = theme;
  document.documentElement.style.colorScheme = theme;
}

onHostPrefChange(STORAGE_KEY, () => {
  store.setState({ preference: load().preference });
  apply(resolve(store.getState()));
});

export function setThemePreference(preference: ThemePreference) {
  store.setState({ preference });
  try {
    localStorage.setItem(STORAGE_KEY, preference);
    mirrorToHost(STORAGE_KEY);
  } catch {
    // storage unavailable
  }
  apply(resolve(store.getState()));
}

export const useThemePreference = () => store((s) => s.preference);
export const useResolvedTheme = (): ResolvedTheme =>
  store((s) => {
    if (s.preference !== "system") {
      return s.preference;
    }

    return s.systemResolved;
  });

export function getResolvedTheme(): ResolvedTheme {
  return resolve(store.getState());
}

export function subscribeResolvedTheme(
  listener: (theme: ResolvedTheme) => void,
): () => void {
  let last = resolve(store.getState());

  return store.subscribe((state) => {
    const next = resolve(state);
    if (next !== last) {
      last = next;
      listener(next);
    }
  });
}

export function initTheme() {
  apply(resolve(store.getState()));

  if (typeof window !== "undefined" && window.matchMedia) {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const handler = (event: MediaQueryListEvent) => {
      const next: ResolvedTheme = event.matches ? "dark" : "light";
      if (store.getState().systemResolved === next) {
        return;
      }
      store.setState({ systemResolved: next });
      apply(resolve(store.getState()));
    };
    if (media.addEventListener) {
      media.addEventListener("change", handler);
    } else {
      media.addListener(handler);
    }
  }
}
