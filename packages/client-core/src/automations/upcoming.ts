import type { UpcomingRun } from "@argus/remote-protocol";
import { clockTimeLabel } from "./teammateFailure";

/** How long until a run fires: "now", "in 5m", "in 3h", "in 2d". */
export function untilLabel(at: number, now: Date = new Date()): string {
  const seconds = (at - now.getTime()) / 1000;
  if (seconds <= 0) {
    return "now";
  }
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) {
    return `in ${Math.max(1, minutes)}m`;
  }
  const hours = Math.floor(minutes / 60);

  return hours < 48 ? `in ${hours}h` : `in ${Math.floor(hours / 24)}d`;
}

/** What holds an upcoming run up, in a sentence; null when nothing does. */
export function upcomingWaitLabel(
  run: UpcomingRun,
  now: Date = new Date(),
): string | null {
  switch (run.waiting) {
    case "limit":
      return run.waiting_until === null
        ? "Waits for the usage limit to reset"
        : `Waits for the usage limit to reset ${clockTimeLabel(run.waiting_until, now)}`;
    case "approval":
      return "Waits for your approval on the run still going";
    case "overlap":
      return "Skipped if the run still going hasn't finished";
    case "paused":
      return "Paused";
    default:
      return null;
  }
}

/** "in 2h · at 14:00". */
export function upcomingWhen(run: UpcomingRun, now: Date = new Date()): string {
  return `${untilLabel(run.next_run_at, now)} · ${clockTimeLabel(run.next_run_at, now)}`;
}

/** "CI Fixer's duty" or "Automation", with "Once · " for a one-time trigger. */
export function upcomingSubtitle(run: UpcomingRun): string {
  const owner = run.teammate_name
    ? `${run.teammate_name}'s duty`
    : "Automation";

  return run.trigger_kind === "once" ? `Once · ${owner}` : owner;
}
