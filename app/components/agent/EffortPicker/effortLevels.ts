/**
 * Reasoning-effort levels Claude Code accepts via the `apply_flag_settings`
 * control message (and the `--effort` CLI flag). Available levels per model
 * are advertised in the initialize-response capabilities
 * (`ModelInfo.supportedEffortLevels`), so the picker filters to that list.
 */

export type EffortLevel = "high" | "low" | "max" | "medium" | "xhigh";

const DISPLAY_NAMES: Record<EffortLevel, string> = {
  low: "Low",
  medium: "Medium",
  high: "High",
  xhigh: "Extra high",
  max: "Max",
};

export const EFFORT_LEVEL_DESCRIPTIONS: Record<EffortLevel, string> = {
  low: "Fastest. Minimal reasoning before acting.",
  medium: "Balanced. The default for most work.",
  high: "Thinks longer for tricky problems.",
  xhigh: "Heavy reasoning for genuinely hard tasks.",
  max: "Maximum reasoning budget. Slowest, most thorough.",
};

export function effortDisplayName(level: string | null | undefined): string {
  if (!level) {
    return "Default";
  }

  return DISPLAY_NAMES[level as EffortLevel] ?? level;
}
