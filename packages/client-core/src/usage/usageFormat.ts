/**
 * Pure formatting for the usage screen: plan limits, tokens and cost.
 */

import type { UsageLimitWindow, UsagePace } from "@argus/remote-protocol";

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

// ---------------------------------------------------------------------------
// Cost and tokens tabs
// ---------------------------------------------------------------------------

const UNITS: { size: number; unit: string }[] = [
  { size: 1e9, unit: "B" },
  { size: 1e6, unit: "M" },
  { size: 1e3, unit: "K" },
];

/** Three significant digits with a unit: `8.90B`, `19.5M`, `49.1K`, `812`. */
export function formatTokens(value: number): string {
  const abs = Math.abs(value);
  // 0.9995 of a unit rounds up to "1.00" of it, so 999,960 reads 1.00M, not 1000K.
  const match = UNITS.find(({ size }) => abs >= size * 0.9995);

  return match
    ? `${(value / match.size).toPrecision(3)}${match.unit}`
    : String(Math.round(value));
}

const USD = new Intl.NumberFormat("en-US", {
  currency: "USD",
  maximumFractionDigits: 2,
  minimumFractionDigits: 2,
  style: "currency",
});

/** `$2,789.77`. */
export function formatUsd(value: number): string {
  return USD.format(value);
}

/** Axis labels: `$1.2K`, `$40`, `$0.5`. */
export function formatUsdCompact(value: number): string {
  const abs = Math.abs(value);
  if (abs >= 1000) {
    return `$${formatTokens(value)}`;
  }

  return `$${String(Math.round(value * 100) / 100)}`;
}

/** Share of a whole: `43.2%`, `<0.1%` for a sliver, `0%` for nothing. */
export function formatShare(part: number, total: number): string {
  if (total <= 0 || part <= 0) {
    return "0%";
  }
  const pct = (part / total) * 100;
  if (pct < 0.1) {
    return "<0.1%";
  }

  return `${Number(pct.toFixed(1))}%`;
}

/** A chart's x label for one bucket: `Oct 3` per day, `14:00` per hour. */
export function bucketLabel(start: number, bucket: "day" | "hour"): string {
  const date = new Date(start);
  if (bucket === "hour") {
    return `${String(date.getHours()).padStart(2, "0")}:00`;
  }

  return date.toLocaleDateString("en-US", { day: "numeric", month: "short" });
}
