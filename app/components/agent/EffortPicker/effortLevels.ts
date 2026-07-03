/**
 * Reasoning-effort levels Claude Code accepts via the `apply_flag_settings`
 * control message (and the `--effort` CLI flag). Model effort levels are
 * advertised in the initialize-response capabilities
 * (`ModelInfo.supportedEffortLevels`), so the picker filters to that list.
 *
 * `ultracode` is not a model effort level and is never advertised; it's a
 * session mode (xhigh effort + standing workflow orchestration) appended as a
 * synthetic option when the model supports xhigh, matching the CLI's picker.
 */

export type EffortLevel =
  | "high"
  | "low"
  | "max"
  | "medium"
  | "ultracode"
  | "xhigh";

export const ULTRACODE_EFFORT = "ultracode";

const DISPLAY_NAMES: Record<EffortLevel, string> = {
  low: "Low",
  medium: "Medium",
  high: "High",
  xhigh: "Extra high",
  max: "Max",
  ultracode: "Ultracode",
};

export const EFFORT_LEVEL_DESCRIPTIONS: Record<EffortLevel, string> = {
  low: "Fastest. Minimal reasoning before acting.",
  medium: "Balanced. The default for most work.",
  high: "Thinks longer for tricky problems.",
  xhigh: "Heavy reasoning for genuinely hard tasks.",
  max: "Maximum reasoning budget. Slowest, most thorough.",
  ultracode:
    "Extra-high effort plus standing workflow orchestration for maximum thoroughness.",
};

export function effortDisplayName(level: string | null | undefined): string {
  if (!level) {
    return "Default";
  }

  return DISPLAY_NAMES[level as EffortLevel] ?? level;
}
