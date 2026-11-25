/**
 * When a plan limit is close enough to warn about: once per runner, account
 * and window, when its usage reaches the threshold in `usage_warning_percent`.
 * Pure, so the rules are testable without a clock, a disk or a notification.
 */

import type { UsageLimitWindow } from "@argus/remote-protocol";

export const DEFAULT_USAGE_WARNING_PERCENT = 90;

/** What `usage_warning_percent` asks for; null when the warning is off. */
export function usageWarningThreshold(
  setting: number | undefined,
): number | null {
  const value = setting ?? DEFAULT_USAGE_WARNING_PERCENT;

  return value > 0 && value <= 100 ? value : null;
}

/** The threshold, bucketed to the values Settings offers. */
export function thresholdBucket(
  threshold: number,
): "75" | "80" | "85" | "90" | "95" | "other" {
  const offered = ["75", "80", "85", "90", "95"] as const;

  return offered.find((t) => Number(t) === threshold) ?? "other";
}

/** A window already warned about, until it resets. */
export interface FiredWarning {
  resets_at: number | null;
}

export type FiredWarnings = Record<string, FiredWarning>;

export function warningKey(
  runner: string,
  accountId: string | null,
  windowId: string,
): string {
  return `${runner}|${accountId ?? ""}|${windowId}`;
}

export interface WarningCheck {
  /** Windows to warn about now, tightest first. */
  due: UsageLimitWindow[];
  fired: FiredWarnings;
  changed: boolean;
}

/**
 * Which of a reading's windows just crossed `threshold`. A window counts once
 * until it resets, or until its usage drops back under, which is how a window
 * without a reset time is seen to start again.
 */
export function dueWarnings(
  runner: string,
  accountId: string | null,
  windows: UsageLimitWindow[],
  threshold: number,
  fired: FiredWarnings,
  now: number,
): WarningCheck {
  const next = { ...fired };
  let changed = false;
  const due: UsageLimitWindow[] = [];
  for (const w of windows) {
    const key = warningKey(runner, accountId, w.id);
    const record = next[key];
    const rolled =
      record?.resets_at !== null &&
      record?.resets_at !== undefined &&
      now >= record.resets_at;
    if (record && (rolled || w.used_percent < threshold)) {
      Reflect.deleteProperty(next, key);
      changed = true;
    }
    const stale = w.resets_at !== null && w.resets_at <= now;
    if (w.used_percent >= threshold && !stale && !next[key]) {
      next[key] = { resets_at: w.resets_at };
      changed = true;
      due.push(w);
    }
  }
  due.sort((a, b) => b.used_percent - a.used_percent);

  return { due, fired: next, changed };
}

/** Drop records whose window has reset, so the file doesn't grow forever. */
export function pruneFired(fired: FiredWarnings, now: number): FiredWarnings {
  return Object.fromEntries(
    Object.entries(fired).filter(
      ([, r]) => r.resets_at === null || r.resets_at > now,
    ),
  );
}

const DAY_MS = 86_400_000;

/** "today at 14:00", "tomorrow at 09:30", "Thu at 14:00" or "Mar 3 at 14:00". */
export function resetPhrase(
  resetsAt: number,
  now: number,
  timeZone?: string,
): string {
  const time = new Intl.DateTimeFormat("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone,
  }).format(resetsAt);
  const day = (t: number) =>
    new Intl.DateTimeFormat("en-CA", { timeZone }).format(t);
  if (day(resetsAt) === day(now)) {
    return `today at ${time}`;
  }
  if (day(resetsAt) === day(now + DAY_MS)) {
    return `tomorrow at ${time}`;
  }
  const date = new Intl.DateTimeFormat(
    "en-US",
    resetsAt - now < 6 * DAY_MS
      ? { weekday: "short", timeZone }
      : { month: "short", day: "numeric", timeZone },
  ).format(resetsAt);

  return `${date} at ${time}`;
}

export interface WarningText {
  title: string;
  body: string;
}

/** The notification: runner and how close in the title, the window and its reset in the body. */
export function warningText(input: {
  runnerLabel: string;
  accountLabel: string | null;
  window: UsageLimitWindow;
  switchLabel: string | null;
  now: number;
  timeZone?: string;
}): WarningText {
  const { window: w } = input;
  const used = Math.min(100, Math.floor(w.used_percent));
  const on = input.accountLabel ? ` on ${input.accountLabel}` : "";
  const resets =
    w.resets_at === null
      ? ""
      : `, resets ${resetPhrase(w.resets_at, input.now, input.timeZone)}`;
  const hint = input.switchLabel
    ? ` Switch to ${input.switchLabel} to keep going.`
    : "";

  return {
    title: `${input.runnerLabel} is at ${used}% of its limit`,
    body: `${w.label} limit${on}${resets}.${hint}`,
  };
}
