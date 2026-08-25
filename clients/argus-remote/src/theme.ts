/**
 * Theme tokens mirroring Peacock's `tokens.css` (dark + light) plus the
 * preference store. RN has no CSS variables, so components read the resolved
 * palette from `useTheme()`.
 */

import { useEffect } from "react";
import { Appearance, type ColorSchemeName } from "react-native";
import { create } from "zustand";
import { readString, writeString } from "./lib/storage";

export type ThemePreference = "dark" | "light" | "system";
export type ResolvedTheme = "dark" | "light";

export const THEME_PREFERENCE_LABELS: Record<ThemePreference, string> = {
  system: "System",
  light: "Light",
  dark: "Dark",
};

const STORAGE_KEY = "argus.theme";

export interface Theme {
  scheme: ResolvedTheme;
  bg: string;
  bgSecondary: string;
  bgTertiary: string;
  bgHover: string;
  border: string;
  borderSubtle: string;
  borderStrong: string;
  text: string;
  textSecondary: string;
  textMuted: string;
  accent: string;
  accentSoft: string;
  accentBorder: string;
  onAccent: string;
  success: string;
  successSoft: string;
  warning: string;
  warningSoft: string;
  error: string;
  errorSoft: string;
  brandPurple: string;
  mediaBg: string;
  radius: number;
  radiusSm: number;
  space: number;
}

const DARK: Theme = {
  scheme: "dark",
  bg: "#15151c",
  bgSecondary: "#1c1c25",
  bgTertiary: "#252531",
  bgHover: "#2d2d3c",
  border: "rgba(255, 255, 255, 0.08)",
  borderSubtle: "rgba(255, 255, 255, 0.04)",
  borderStrong: "rgba(255, 255, 255, 0.15)",
  text: "#d8d8e2",
  textSecondary: "#a8a8b8",
  textMuted: "#70708a",
  accent: "#f5a623",
  accentSoft: "rgba(245, 166, 35, 0.12)",
  accentBorder: "rgba(245, 166, 35, 0.4)",
  onAccent: "#15151c",
  success: "#00d4aa",
  successSoft: "rgba(0, 212, 170, 0.12)",
  warning: "#ffd54a",
  warningSoft: "rgba(255, 213, 74, 0.12)",
  error: "#ff4466",
  errorSoft: "rgba(255, 68, 102, 0.12)",
  brandPurple: "#7c5cfc",
  mediaBg: "#000000",
  radius: 12,
  radiusSm: 8,
  space: 12,
};

const LIGHT: Theme = {
  ...DARK,
  scheme: "light",
  bg: "#fafbfc",
  bgSecondary: "#ffffff",
  bgTertiary: "#eceef2",
  bgHover: "#dcdfe6",
  border: "rgba(10, 10, 15, 0.14)",
  borderSubtle: "rgba(10, 10, 15, 0.08)",
  borderStrong: "rgba(10, 10, 15, 0.24)",
  text: "#0d0d14",
  textSecondary: "#2f2f40",
  textMuted: "#5c5c72",
  accent: "#c7861f",
  accentSoft: "rgba(199, 134, 31, 0.14)",
  accentBorder: "rgba(199, 134, 31, 0.5)",
  onAccent: "#ffffff",
  success: "#00a884",
  successSoft: "rgba(0, 168, 132, 0.16)",
  warning: "#d69a00",
  warningSoft: "rgba(214, 154, 0, 0.16)",
  error: "#dc2c49",
  errorSoft: "rgba(220, 44, 73, 0.12)",
};

interface ThemeState {
  preference: ThemePreference;
  system: ResolvedTheme;
}

const store = create<ThemeState>(() => ({
  preference: "system",
  system: Appearance.getColorScheme() === "light" ? "light" : "dark",
}));

function resolve(state: ThemeState): ResolvedTheme {
  return state.preference === "system" ? state.system : state.preference;
}

export function setThemePreference(preference: ThemePreference): void {
  store.setState({ preference });
  writeString(STORAGE_KEY, preference).catch(() => {});
}

export function useThemePreference(): ThemePreference {
  return store((s) => s.preference);
}

export function useTheme(): Theme {
  const scheme = store(resolve);

  return scheme === "light" ? LIGHT : DARK;
}

export function getTheme(): Theme {
  return resolve(store.getState()) === "light" ? LIGHT : DARK;
}

/** Load the stored preference and track OS scheme changes. Call once at boot. */
export function useThemeBootstrap(): void {
  useEffect(() => {
    readString(STORAGE_KEY)
      .then((raw) => {
        if (raw === "light" || raw === "dark" || raw === "system") {
          store.setState({ preference: raw });
        }
      })
      .catch(() => {});
    const sub = Appearance.addChangeListener(
      ({ colorScheme }: { colorScheme: ColorSchemeName }) => {
        store.setState({ system: colorScheme === "light" ? "light" : "dark" });
      },
    );

    return () => sub.remove();
  }, []);
}
