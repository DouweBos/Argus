/** Colour theme presets; ids match `html[data-color-theme]` in tokens.css. */
export const COLOR_THEME_IDS = [
  "amber",
  "grove",
  "ocean",
  "ember",
  "iris",
  "rose",
] as const;

export type ColorThemeId = (typeof COLOR_THEME_IDS)[number];

export const COLOR_THEME_LABELS: Record<ColorThemeId, string> = {
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
