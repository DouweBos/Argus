/**
 * Pure formatting for the usage screen's plan limits.
 */

import type { UsageLimitWindow, UsagePace } from "./types";

export type UsageLimitTone = "accent" | "danger" | "warning";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** Whole percent of the window still available, clamped to 0–100. */
export function percentLeft(usedPercent: number): number {
  return Math.round(Math.min(100, Math.max(0, 100 - usedPercent)));
}

/** `4h 29m`, `5d 1h`, `12m`; `null` once the reset has passed. */
export function formatCountdown(ms: number): string | null {
  if (ms <= 0) {
    return null;
  }
  if (ms < MINUTE) {
    return "<1m";
  }
  const days = Math.floor(ms / DAY);
  const hours = Math.floor((ms % DAY) / HOUR);
  const minutes = Math.floor((ms % HOUR) / MINUTE);
  if (days > 0) {
    return hours > 0 ? `${days}d ${hours}h` : `${days}d`;
  }
  if (hours > 0) {
    return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`;
  }

  return `${minutes}m`;
}

/** "Resets in 4h 29m"; `null` when the plan gave no reset time. */
export function resetHint(resetsAt: number | null, now: number): string | null {
  if (resetsAt === null) {
    return null;
  }
  const countdown = formatCountdown(resetsAt - now);

  return countdown ? `Resets in ${countdown}` : "Resetting now";
}

const PACE_LABELS: Record<UsagePace, string> = {
  ahead: "Ahead of pace",
  on: "On pace",
  under: "Under pace",
};

export function paceLabel(pace: UsagePace | null): string | null {
  return pace ? PACE_LABELS[pace] : null;
}

/** Spending faster than the window elapses, or nearly out, is worth a colour. */
export function limitTone(window: UsageLimitWindow): UsageLimitTone {
  if (window.used_percent >= 90) {
    return "danger";
  }

  return window.used_percent >= 75 || window.pace === "ahead"
    ? "warning"
    : "accent";
}
