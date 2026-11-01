/**
 * How automations and their runs read on every client: labels, tones, times,
 * the cron preview. Shaped on the fields the catalog's and the gateway's
 * models share, so the desktop and the web client never disagree.
 */

import type {
  RemoteAutomation,
  RemoteAutomationGuardrails,
  RemoteAutomationRunStatus,
} from "@argus/remote-protocol";
import { formatDuration } from "../transcript/workLog";
import { computeNextRun, isValidCron } from "./cron";
import { cronLabel } from "./cronLabel";

export type AutonomyLevel = "auto_merge" | "draft" | "pr" | "propose";

/** Ascending: each rung permits everything the one before it does. */
export const AUTONOMY_LEVELS: readonly AutonomyLevel[] = [
  "propose",
  "draft",
  "pr",
  "auto_merge",
];

export const AUTONOMY_LABELS: Record<AutonomyLevel, string> = {
  propose: "Propose",
  draft: "Draft",
  pr: "Pull request",
  auto_merge: "Auto-merge",
};

export const AUTONOMY_CAPTIONS: Record<AutonomyLevel, string> = {
  propose: "Put it in the inbox and touch nothing.",
  draft: "Open a worktree, implement it, commit — then stop.",
  pr: "Also push the branch and open a draft pull request.",
  auto_merge: "Also merge it once CI is green. Opt-in only.",
};

/** The host's own defaults, for a client that has to send a whole set. */
export const DEFAULT_GUARDRAILS: Required<RemoteAutomationGuardrails> = {
  confidence_threshold: 0.8,
  max_concurrent_sessions: 2,
  max_files_changed: 25,
  max_cost_usd_per_run: 0,
  max_run_minutes: 20,
  path_denylist: [],
  require_clean_ci: true,
  retry_other_accounts: true,
};

/** Badge tones, by name, so this stays free of any UI package. */
export type StatusTone = "accent" | "error" | "neutral" | "success" | "warning";

const RUN_STATUS_TONES: Record<RemoteAutomationRunStatus, StatusTone> = {
  cancelled: "neutral",
  failed: "error",
  queued: "neutral",
  running: "accent",
  skipped: "warning",
  succeeded: "success",
};

export function runStatusTone(status: RemoteAutomationRunStatus): StatusTone {
  return RUN_STATUS_TONES[status];
}

export function isRunActive(run: {
  status: RemoteAutomationRunStatus;
}): boolean {
  return run.status === "queued" || run.status === "running";
}

/** The zone this client is in — the default for a new schedule. */
export function localTimezone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
}

/**
 * The next `count` instants a cron fires at, empty when it does not parse.
 * "Every five minutes" and "five past every hour" look alike until you see
 * the times they produce.
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

/** One line for a list row: the schedule in words, or "Manual". */
export function scheduleLabel(
  automation: Pick<RemoteAutomation, "cron" | "trigger_kind">,
): string {
  if (automation.trigger_kind === "manual") {
    return "Manual";
  }

  return automation.cron ? cronLabel(automation.cron) : "Scheduled";
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
export function formatRunDuration(
  run: { finished_at: number | null; started_at: number },
  now = Date.now(),
): string {
  const end = run.finished_at ?? now;

  return formatDuration(Math.round((end - run.started_at) / 1000));
}

export function formatCost(costUsd: number | null): string {
  return costUsd === null ? "—" : `$${costUsd.toFixed(2)}`;
}

/** What a list shows under "next run". */
export function nextRunLabel(
  automation: Pick<
    RemoteAutomation,
    "enabled" | "next_run_at" | "trigger_kind"
  >,
  now = Date.now(),
): string {
  if (automation.trigger_kind !== "schedule") {
    return "Manual";
  }
  if (!automation.enabled) {
    return "Paused";
  }

  return automation.next_run_at === null
    ? "—"
    : `${formatTimestamp(automation.next_run_at)} (${formatRelative(automation.next_run_at, now)})`;
}
