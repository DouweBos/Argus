/**
 * The one-time trigger's clock: a local wall-clock `YYYY-MM-DDTHH:mm` in an
 * IANA zone, so "tomorrow at 9" stays 9 where you are across a DST change.
 */

import { type LocalParts, zonedParts, zonedTimeToUtc } from "./cron";

const LOCAL_DATE_TIME = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/;

/** Calendar fields of a `YYYY-MM-DDTHH:mm`, or null when it isn't one. */
export function parseLocalDateTime(value: string): LocalParts | null {
  const m = LOCAL_DATE_TIME.exec(value.trim());
  if (!m) {
    return null;
  }
  const [year, month, day, hour, minute] = m.slice(1).map(Number) as [
    number,
    number,
    number,
    number,
    number,
  ];
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  if (
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > lastDay ||
    hour > 23 ||
    minute > 59
  ) {
    return null;
  }

  return { year, month, day, hour, minute };
}

/** `YYYY-MM-DDTHH:mm` for an instant, as the wall clock reads it in `timezone`. */
export function formatLocalDateTime(instant: number, timezone: string): string {
  const p = zonedParts(timezone, instant);
  const pad = (n: number): string => String(n).padStart(2, "0");

  return `${p.year}-${pad(p.month)}-${pad(p.day)}T${pad(p.hour)}:${pad(p.minute)}`;
}

/** The instant a one-time trigger fires at, or null when `at` doesn't parse. */
export function onceInstant(at: string, timezone: string): number | null {
  const parts = parseLocalDateTime(at);
  if (!parts) {
    return null;
  }
  try {
    return zonedTimeToUtc(timezone, parts);
  } catch {
    return null;
  }
}

/** Why a one-time trigger can't be saved, or null when it can. */
export function onceError(
  at: string,
  timezone: string,
  now: number = Date.now(),
): string | null {
  const instant = onceInstant(at, timezone);
  if (instant === null) {
    return "Pick a date and time.";
  }
  if (instant <= now) {
    return "That time has already passed.";
  }

  return null;
}

/** A sensible default for a new one-time trigger: the next whole hour. */
export function defaultOnceAt(
  timezone: string,
  now: number = Date.now(),
): string {
  const hour = 3_600_000;

  return formatLocalDateTime(Math.floor(now / hour) * hour + hour, timezone);
}
