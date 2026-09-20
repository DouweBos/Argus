/**
 * Formatting for the automation screens. Pure — no React, no transport.
 *
 * The computer sends the cron raw rather than a rendered label, because
 * "every 30 minutes" reads better than the expression and only the client
 * knows how much room it has to say it.
 */

import type {
  RemoteAutomation,
  RemoteAutomationRun,
  RemoteAutomationRunStatus,
} from "./protocol";

export type RunTone = "accent" | "danger" | "muted" | "success" | "warning";

export function runTone(status: RemoteAutomationRunStatus): RunTone {
  switch (status) {
    case "running":
    case "queued":
      return "accent";
    case "succeeded":
      return "success";
    case "failed":
      return "danger";
    case "skipped":
      return "warning";
    default:
      return "muted";
  }
}

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function dayList(dow: string): string | null {
  if (dow === "*") {
    return null;
  }
  if (dow === "1-5") {
    return "weekdays";
  }
  const names = dow
    .split(",")
    .map((d) => DAYS[Number(d) % 7])
    .filter(Boolean);

  return names.length > 0 ? names.join(", ") : null;
}

/**
 * A 5-field cron in words. Falls back to the expression itself for anything
 * fancier than the shapes the built-in templates use — a wrong-but-confident
 * reading of a cron is worse than showing the cron.
 */
export function cronLabel(cron: string): string {
  const [min, hour, dom, mon, dow] = cron.trim().split(/\s+/);
  if (!min || !hour || !dom || !mon || !dow) {
    return cron;
  }
  if (dom !== "*" || mon !== "*") {
    return cron;
  }
  const days = dayList(dow);
  const suffix = days ? `, ${days}` : " daily";

  if (hour === "*" && /^\*\/(\d+)$/.test(min)) {
    return `every ${min.slice(2)} minutes`;
  }
  if (/^\d+$/.test(hour) && /^\d+$/.test(min)) {
    const time = `${hour.padStart(2, "0")}:${min.padStart(2, "0")}`;

    return `${time}${suffix}`;
  }

  return cron;
}

export function triggerLabel(automation: RemoteAutomation): string {
  if (automation.trigger_kind === "manual" || !automation.cron) {
    return "Manual";
  }

  return cronLabel(automation.cron);
}

/** "in 4h" / "in 12m" / "now" — null when nothing is scheduled. */
export function untilLabel(ms: number | null, now = Date.now()): string | null {
  if (ms === null) {
    return null;
  }
  const delta = ms - now;
  if (delta <= 0) {
    return "now";
  }
  const minutes = Math.round(delta / 60_000);
  if (minutes < 60) {
    return `in ${minutes}m`;
  }
  const hours = Math.round(minutes / 60);
  if (hours < 48) {
    return `in ${hours}h`;
  }

  return `in ${Math.round(hours / 24)}d`;
}

/** How long a run took, counting up while it is still going. */
export function runDuration(
  run: RemoteAutomationRun,
  now = Date.now(),
): string {
  const end = run.finished_at ?? now;
  const seconds = Math.max(0, Math.round((end - run.started_at) / 1000));
  if (seconds < 60) {
    return `${seconds}s`;
  }
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) {
    return `${minutes}m ${seconds % 60}s`;
  }

  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

export function runCost(costUsd: number | null): string {
  return costUsd === null ? "—" : `$${costUsd.toFixed(2)}`;
}
