/**
 * The clock. One 30-second interval, started from `main.ts`.
 *
 * Two behaviours matter more than the timer itself:
 *
 * - **Missed fires coalesce.** A laptop closed overnight produces one catch-up
 *   run, not one per missed slot. There is no backfill queue anywhere.
 * - **No overlap.** A fire while the previous run is still going records a
 *   `skipped` run with the reason and moves the schedule on.
 *
 * A one-time trigger follows the same rules, then pauses its automation.
 *
 * It touches no window and no renderer — state changes go out on the host bus
 * — so a headless mini runs it unchanged.
 */

import { info } from "@argus/host/logger";
import { loadAppSettings } from "../appSettings/store";
import { capture as telemetryCapture } from "../telemetry/telemetry";
import {
  createRun,
  hasActiveRun,
  listAutomations,
  rescheduleAutomation,
  retireOnceAutomation,
} from "./manager";
import { startAutomationRun } from "./runner";

const TICK_MS = 30_000;

/**
 * How late a fire may be and still count as "on time". Anything later means
 * the host was asleep or busy, so the run is a catch-up — and only happens at
 * all when the automation opted in.
 */
const LATE_GRACE_MS = 2 * 60_000;

let timer: ReturnType<typeof setInterval> | null = null;

/** Start the scheduler. Safe to call twice; the second call is a no-op. */
export function startAutomationScheduler(): void {
  if (timer) {
    return;
  }
  timer = setInterval(() => {
    tickAutomations();
  }, TICK_MS);
  timer.unref?.();
  info("Automation scheduler started");

  // Boot tick: anything due while the app was closed is decided now.
  tickAutomations();
}

export function stopAutomationScheduler(): void {
  if (!timer) {
    return;
  }
  clearInterval(timer);
  timer = null;
}

/**
 * Evaluate every automation once. Exported for tests — callers pass the clock
 * rather than waiting on a real interval.
 */
export function tickAutomations(now: number = Date.now()): void {
  if (loadAppSettings().automations_enabled === false) {
    return;
  }

  for (const automation of listAutomations()) {
    const { trigger } = automation;
    if (!automation.enabled || trigger.kind === "manual") {
      continue;
    }

    if (automation.next_run_at === null) {
      // Newly enabled, or its cron changed — give it a clock and wait.
      rescheduleAutomation(automation.id, now);
      continue;
    }

    if (automation.next_run_at > now) {
      continue;
    }

    // However many windows went by while the host was asleep, this is one
    // decision: fire once, or do not fire. The clock then moves to the next
    // window ahead of `now`, which is what makes a backfill impossible.
    const late = now - automation.next_run_at > LATE_GRACE_MS;
    const once = trigger.kind === "once";
    const local = formatLocalTime(automation.next_run_at, trigger.timezone);
    let reason = once ? `once ${local}` : `schedule ${local}`;
    if (late) {
      reason = `catch-up (due ${new Date(automation.next_run_at).toISOString()})`;
    }

    // A one-time trigger is spent whatever happens next: run, skip or miss.
    if (once) {
      retireOnceAutomation(automation.id);
    } else {
      rescheduleAutomation(automation.id, now);
    }

    if (late && !trigger.catch_up) {
      if (once) {
        telemetryCapture("automation_once_fired", { outcome: "missed" });
      }
      continue;
    }

    if (hasActiveRun(automation.id)) {
      if (once) {
        telemetryCapture("automation_once_fired", { outcome: "overlap" });
      }
      // Never two hosts for one automation. The skip is recorded so the run
      // history explains the gap.
      createRun(
        automation.id,
        "skipped",
        reason,
        "The previous run was still in progress.",
      );
      continue;
    }

    if (once) {
      telemetryCapture("automation_once_fired", {
        outcome: late ? "caught_up" : "ran",
      });
    }
    startAutomationRun(automation.id, reason);
  }
}

function formatLocalTime(instant: number, timezone: string): string {
  try {
    return new Intl.DateTimeFormat("en-GB", {
      timeZone: timezone,
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).format(new Date(instant));
  } catch {
    return new Date(instant).toISOString();
  }
}
