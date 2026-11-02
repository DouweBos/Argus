import { describe, expect, it } from "vitest";
import {
  clearNotifications,
  dismissNotification,
  EMPTY_NOTIFICATIONS_LOG,
  markNotificationsSeen,
  NOTIFICATIONS_CAP,
  notificationRows,
  notificationsSummary,
  notificationTimeAgo,
  pushNotification,
  unseenNotificationCount,
  type NotificationsLog,
} from "./notificationsLog";

// The cases of ArgusCore's `NotificationsLogTests`.
describe("notifications log", () => {
  it("a repeat collapses into the newest entry and doesn't count as new", () => {
    let now = 1_000_000;
    let log: NotificationsLog = EMPTY_NOTIFICATIONS_LOG;
    log = pushNotification(log, {
      level: "error",
      message: "offline",
      source: "agents",
      at: now,
    });
    log = markNotificationsSeen(log, now);
    now += 1000;
    log = pushNotification(log, {
      level: "error",
      message: "offline",
      source: "agents",
      at: now,
    });
    expect(log.entries).toHaveLength(1);
    expect(log.entries[0].count).toBe(2);
    expect(log.entries[0].timestamp).toBe(now);
    expect(unseenNotificationCount(log)).toBe(0);

    now += 1000;
    log = pushNotification(log, {
      level: "warning",
      message: "offline",
      source: "agents",
      at: now,
    });
    log = pushNotification(log, {
      level: "error",
      message: "offline",
      source: "agents",
      at: now,
    });
    expect(log.entries.map((e) => e.level)).toEqual([
      "error",
      "warning",
      "error",
    ]);
    expect(unseenNotificationCount(log)).toBe(2);
  });

  it("newest first, capped, and one can be dismissed", () => {
    let now = 1_000_000;
    let log: NotificationsLog = EMPTY_NOTIFICATIONS_LOG;
    for (let index = 0; index < NOTIFICATIONS_CAP + 5; index += 1) {
      now += 1000;
      log = pushNotification(log, {
        level: "error",
        message: `e${String(index)}`,
        at: now,
      });
    }
    expect(log.entries).toHaveLength(NOTIFICATIONS_CAP);
    expect(log.entries[0].message).toBe(`e${String(NOTIFICATIONS_CAP + 4)}`);

    const { id } = log.entries[0];
    log = dismissNotification(log, id);
    expect(log.entries.some((e) => e.id === id)).toBe(false);

    log = clearNotifications(log, now);
    expect(log.entries).toHaveLength(0);
    expect(unseenNotificationCount(log)).toBe(0);
  });

  it("a different source is a different entry", () => {
    let log = pushNotification(EMPTY_NOTIFICATIONS_LOG, {
      level: "error",
      message: "x",
      source: "a",
      at: 1,
    });
    log = pushNotification(log, { level: "error", message: "x", at: 2 });
    expect(log.entries).toHaveLength(2);
  });
});

describe("notification rows", () => {
  it("reads how long ago", () => {
    expect(notificationTimeAgo(0, 2_000)).toBe("just now");
    expect(notificationTimeAgo(0, 42_000)).toBe("42s");
    expect(notificationTimeAgo(0, 5 * 60_000)).toBe("5m");
    expect(notificationTimeAgo(0, 3 * 3_600_000)).toBe("3h");
    expect(notificationTimeAgo(0, 50 * 3_600_000)).toBe("2d");
  });

  it("carries the repeat count and summarises the levels", () => {
    let log = pushNotification(EMPTY_NOTIFICATIONS_LOG, {
      level: "warning",
      message: "slow",
      at: 0,
    });
    log = pushNotification(log, { level: "warning", message: "slow", at: 0 });
    log = pushNotification(log, { level: "error", message: "boom", at: 0 });
    expect(notificationRows(log.entries, 0).map((r) => r.count)).toEqual([
      1, 2,
    ]);
    expect(notificationsSummary(log.entries)).toBe("1 error · 1 warning");
    expect(notificationsSummary([])).toBe("Everything looks clear");
  });
});
