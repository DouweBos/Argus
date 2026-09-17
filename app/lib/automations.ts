/**
 * Presentation helpers for automations — formatting, status tone and the
 * cron preview. The cron evaluator itself is the host's, imported rather than
 * reimplemented so the times the editor promises are the times that fire.
 */

import type {
  Automation,
  AutomationRun,
  AutomationRunStatus,
  AutomationTrigger,
} from "./types";
import type { BadgeTone } from "@argus/peacock";
import {
  computeNextRun,
  isValidCron,
} from "@argus/host/services/automation/cron";

export { isValidCron };

/** The zone the machine is in — the default for a new schedule. */
export function localTimezone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
}

/**
 * The next `count` instants a cron expression fires at, empty when it does not
 * parse. Drives the editor preview: "every five minutes" and "at five past
 * every hour" look alike until you see the times they produce.
 */
export function nextFireTimes(
  cron: string,
  timezone: string,
  count: number,
  from: number = Date.now(),
): number[] {
  const out: number[] = [];
  let cursor = from;
  try {
    for (let i = 0; i < count; i += 1) {
      const next = computeNextRun(cron, timezone, cursor);
      if (next === null) {
        break;
      }
      out.push(next);
      cursor = next;
    }
  } catch {
    return [];
  }

  return out;
}

/** Why a cron expression is rejected, or null when it is fine. */
export function cronError(cron: string, timezone: string): string | null {
  if (!isValidCron(cron)) {
    return "Five fields, `min hour dom mon dow`.";
  }
  if (nextFireTimes(cron, timezone, 1).length === 0) {
    return "Valid, but never fires within the next four years.";
  }

  return null;
}

/** One-line description of a trigger, for list rows. */
export function triggerLabel(trigger: AutomationTrigger): string {
  return trigger.kind === "schedule"
    ? `${trigger.cron} · ${trigger.timezone}`
    : "Manual only";
}

const STATUS_TONE: Record<AutomationRunStatus, BadgeTone> = {
  cancelled: "neutral",
  failed: "error",
  queued: "neutral",
  running: "accent",
  skipped: "warning",
  succeeded: "success",
};

export function runStatusTone(status: AutomationRunStatus): BadgeTone {
  return STATUS_TONE[status];
}

export function isRunActive(run: AutomationRun): boolean {
  return run.status === "queued" || run.status === "running";
}

/** Wall-clock time and date, in the viewer's zone. */
export function formatTimestamp(ms: number | null): string {
  if (ms === null) {
    return "—";
  }

  return new Date(ms).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** Coarse "2h ago" / "in 3m" phrasing. Null renders as an em dash. */
export function formatRelative(ms: number | null, now = Date.now()): string {
  if (ms === null) {
    return "—";
  }
  const delta = ms - now;
  const abs = Math.abs(delta);
  let unit = `${Math.round(abs / 86_400_000)}d`;
  if (abs < 60_000) {
    unit = `${Math.max(1, Math.round(abs / 1000))}s`;
  } else if (abs < 3_600_000) {
    unit = `${Math.round(abs / 60_000)}m`;
  } else if (abs < 86_400_000) {
    unit = `${Math.round(abs / 3_600_000)}h`;
  }

  return delta > 0 ? `in ${unit}` : `${unit} ago`;
}

/** How long a run took, or how long it has been going. */
export function formatDuration(run: AutomationRun, now = Date.now()): string {
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

export function formatCost(costUsd: number | null): string {
  return costUsd === null ? "—" : `$${costUsd.toFixed(2)}`;
}

/** What the list shows under "next run". */
export function nextRunLabel(automation: Automation): string {
  if (automation.trigger.kind !== "schedule") {
    return "Manual";
  }
  if (!automation.enabled) {
    return "Paused";
  }

  return automation.next_run_at === null
    ? "—"
    : `${formatTimestamp(automation.next_run_at)} (${formatRelative(automation.next_run_at)})`;
}
