/**
 * The warnings and errors list behind Notifications: in memory, newest first,
 * capped, a repeat folded into the entry before it. Port of ArgusCore's
 * `NotificationsLog`, as pure functions over a state a store holds.
 */

export type NotificationLevel = "error" | "warning";

export interface NotificationEntry {
  id: string;
  level: NotificationLevel;
  message: string;
  source: string | null;
  /** When it first appeared; a repeat doesn't make it new again. */
  firstAt: number;
  /** When it last happened. */
  timestamp: number;
  /** How many times in a row it happened. */
  count: number;
}

export interface NotificationsLog {
  entries: NotificationEntry[];
  lastSeenAt: number;
}

export const NOTIFICATIONS_CAP = 200;

export const EMPTY_NOTIFICATIONS_LOG: NotificationsLog = {
  entries: [],
  lastSeenAt: 0,
};

let nextId = 0;

export function pushNotification(
  log: NotificationsLog,
  entry: {
    level: NotificationLevel;
    message: string;
    source?: string | null;
    at: number;
  },
): NotificationsLog {
  const source = entry.source ?? null;
  const [first, ...rest] = log.entries;
  // A polling screen repeats its failure every few seconds; keep one entry.
  if (
    first &&
    first.level === entry.level &&
    first.message === entry.message &&
    first.source === source
  ) {
    return {
      ...log,
      entries: [
        { ...first, timestamp: entry.at, count: first.count + 1 },
        ...rest,
      ],
    };
  }
  nextId += 1;
  const next: NotificationEntry = {
    id: `n${String(entry.at)}-${String(nextId)}`,
    level: entry.level,
    message: entry.message,
    source,
    firstAt: entry.at,
    timestamp: entry.at,
    count: 1,
  };

  return {
    ...log,
    entries: [next, ...log.entries].slice(0, NOTIFICATIONS_CAP),
  };
}

export function dismissNotification(
  log: NotificationsLog,
  id: string,
): NotificationsLog {
  return { ...log, entries: log.entries.filter((e) => e.id !== id) };
}

export function clearNotifications(
  _log: NotificationsLog,
  at: number,
): NotificationsLog {
  return { entries: [], lastSeenAt: at };
}

export function markNotificationsSeen(
  log: NotificationsLog,
  at: number,
): NotificationsLog {
  return { ...log, lastSeenAt: at };
}

/** Repeats only count once, so a polling screen's failure can't keep the badge climbing. */
export function unseenNotificationCount(log: NotificationsLog): number {
  return log.entries.reduce(
    (n, e) => (e.firstAt > log.lastSeenAt ? n + 1 : n),
    0,
  );
}

/** `just now`, `42s`, `5m`, `3h`, `2d`. */
export function notificationTimeAgo(ts: number, now: number): string {
  const sec = Math.floor((now - ts) / 1000);
  if (sec < 5) {
    return "just now";
  }
  if (sec < 60) {
    return `${String(sec)}s`;
  }
  const min = Math.floor(sec / 60);
  if (min < 60) {
    return `${String(min)}m`;
  }
  const hr = Math.floor(min / 60);
  if (hr < 24) {
    return `${String(hr)}h`;
  }

  return `${String(Math.floor(hr / 24))}d`;
}

/** One row of the Notifications list. */
export interface NotificationRowView {
  id: string;
  level: NotificationLevel;
  message: string;
  source: string | null;
  count: number;
  time: string;
}

export function notificationRows(
  entries: NotificationEntry[],
  now: number,
): NotificationRowView[] {
  return entries.map((e) => ({
    id: e.id,
    level: e.level,
    message: e.message,
    source: e.source,
    count: e.count,
    time: notificationTimeAgo(e.timestamp, now),
  }));
}

/** "2 errors · 1 warning", or that nothing is wrong. */
export function notificationsSummary(entries: NotificationEntry[]): string {
  if (entries.length === 0) {
    return "Everything looks clear";
  }
  const errors = entries.filter((e) => e.level === "error").length;
  const warnings = entries.length - errors;

  return `${String(errors)} error${errors === 1 ? "" : "s"} · ${String(warnings)} warning${warnings === 1 ? "" : "s"}`;
}
