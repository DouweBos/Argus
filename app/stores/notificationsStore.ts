import { create } from "zustand";
import {
  clearNotifications as clearLog,
  dismissNotification as dismissFromLog,
  EMPTY_NOTIFICATIONS_LOG,
  markNotificationsSeen as markLogSeen,
  type NotificationEntry,
  type NotificationLevel,
  type NotificationsLog,
  pushNotification,
  unseenNotificationCount,
} from "@argus/client-core";

export type { NotificationLevel };
export type Notification = NotificationEntry;

const notificationsStore = create<NotificationsLog>(
  () => EMPTY_NOTIFICATIONS_LOG,
);

const push = (level: NotificationLevel, message: string, source?: string) =>
  notificationsStore.setState((s) =>
    pushNotification(s, { level, message, source, at: Date.now() }),
  );

export const pushError = (message: string, source?: string) =>
  push("error", message, source);

export const pushWarning = (message: string, source?: string) =>
  push("warning", message, source);

export const dismissNotification = (id: string) =>
  notificationsStore.setState((s) => dismissFromLog(s, id));

export const clearNotifications = () =>
  notificationsStore.setState((s) => clearLog(s, Date.now()));

export const markNotificationsSeen = () =>
  notificationsStore.setState((s) => markLogSeen(s, Date.now()));

export const useNotifications = () => notificationsStore((s) => s.entries);

export const useUnseenNotificationCount = () =>
  notificationsStore(unseenNotificationCount);
