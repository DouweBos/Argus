import type { CliProjectCandidate } from "./types";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** Pre-ticked: not yet a project, at least this many chats, used this recently. */
export const DEFAULT_MIN_CHATS = 3;
export const DEFAULT_MAX_AGE_MS = 30 * DAY;

/** Compact age: "now", "1m", "4h", "6d", "3mo", "2y". */
export function formatShortAge(thenMs: number, nowMs: number): string {
  const diff = Math.max(0, nowMs - thenMs);
  if (diff < MINUTE) {
    return "now";
  }
  if (diff < HOUR) {
    return `${Math.floor(diff / MINUTE)}m`;
  }
  if (diff < DAY) {
    return `${Math.floor(diff / HOUR)}h`;
  }
  if (diff < 30 * DAY) {
    return `${Math.floor(diff / DAY)}d`;
  }
  if (diff < 365 * DAY) {
    return `${Math.floor(diff / (30 * DAY))}mo`;
  }

  return `${Math.floor(diff / (365 * DAY))}y`;
}

/** Shortens `text` to `max` characters by cutting out its middle. */
export function truncateMiddle(text: string, max: number): string {
  if (text.length <= max || max < 3) {
    return text;
  }
  const keep = max - 1;
  const head = Math.ceil(keep / 2);
  const tail = keep - head;

  return `${text.slice(0, head)}…${text.slice(text.length - tail)}`;
}

export function isDefaultSelected(
  candidate: CliProjectCandidate,
  nowMs: number,
): boolean {
  return (
    !candidate.added &&
    candidate.chat_count >= DEFAULT_MIN_CHATS &&
    nowMs - candidate.last_active_at <= DEFAULT_MAX_AGE_MS
  );
}

export function defaultSelection(
  candidates: CliProjectCandidate[],
  nowMs: number,
): Set<string> {
  return new Set(
    candidates.filter((c) => isDefaultSelected(c, nowMs)).map((c) => c.path),
  );
}

export function formatChatCount(count: number): string {
  return count === 1 ? "1 chat" : `${count} chats`;
}
