/** The two kinds of agent alert a device can choose between. */

import type { NotificationPrefs } from "@argus/remote-protocol";
import { capture } from "../telemetry/telemetry";

export type NotificationCategory = "finished" | "needs_you";

/** `RemoteNotificationPayload["kind"]`, spelled out to keep this module a leaf. */
type NotificationKind = "failed" | "finished" | "permission" | "push" | "usage";

/** A finished turn is "finished"; prompts, failures, nudges and usage warnings wait on you. */
export function notificationCategory(
  kind: NotificationKind,
): NotificationCategory {
  return kind === "finished" ? "finished" : "needs_you";
}

/** Whether `prefs` (absent: everything) let a notification of `kind` through. */
export function wantsNotification(
  prefs: NotificationPrefs | undefined,
  kind: NotificationKind,
): boolean {
  return prefs ? prefs[notificationCategory(kind)] : true;
}

/** This computer's own banner choice, from app settings; both default on. */
export function desktopNotificationPrefs(settings: {
  notify_needs_you?: boolean;
  notify_finished?: boolean;
}): NotificationPrefs {
  return {
    needs_you: settings.notify_needs_you !== false,
    finished: settings.notify_finished !== false,
  };
}

/** One event per category that flipped; `before` absent counts as both on. */
export function captureCategoryChanges(
  surface: "desktop" | "device",
  before: NotificationPrefs | undefined,
  after: NotificationPrefs,
): void {
  for (const category of ["needs_you", "finished"] as const) {
    const was = before ? before[category] : true;
    if (was !== after[category]) {
      capture("notification_category_changed", {
        category,
        on: after[category],
        surface,
      });
    }
  }
}
