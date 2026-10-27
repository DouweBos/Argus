/** Colour theme presets; ids match `html[data-color-theme]` in tokens.css. */
export const COLOR_THEME_IDS = [
  "muted",
  "amber",
  "grove",
  "ocean",
  "ember",
  "iris",
  "rose",
] as const;

export type ColorThemeId = (typeof COLOR_THEME_IDS)[number];

/** What an unset preference resolves to. */
export const DEFAULT_COLOR_THEME: ColorThemeId = "muted";

export const COLOR_THEME_LABELS: Record<ColorThemeId, string> = {
  muted: "Muted",
  amber: "Amber",
  grove: "Grove",
  ocean: "Ocean",
  ember: "Ember",
  iris: "Iris",
  rose: "Rose",
};

export function isColorThemeId(value: unknown): value is ColorThemeId {
  return (
    typeof value === "string" &&
    (COLOR_THEME_IDS as readonly string[]).includes(value)
  );
}
