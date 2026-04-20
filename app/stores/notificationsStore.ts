import { create } from "zustand";

export type NotificationLevel = "error" | "warning";

export interface Notification {
  id: string;
  level: NotificationLevel;
  message: string;
  source?: string;
  timestamp: number;
}

interface NotificationsStoreData {
  entries: Notification[];
  lastSeenAt: number;
}

const MAX_ENTRIES = 200;

const notificationsStore = create<NotificationsStoreData>(() => ({
  entries: [],
  lastSeenAt: 0,
}));

let nextId = 0;

const push = (level: NotificationLevel, message: string, source?: string) => {
  const entry: Notification = {
    id: `n${Date.now()}-${nextId++}`,
    level,
    message,
    source,
    timestamp: Date.now(),
  };
  notificationsStore.setState((s) => ({
    entries: [entry, ...s.entries].slice(0, MAX_ENTRIES),
  }));
};

export const pushError = (message: string, source?: string) =>
  push("error", message, source);

export const pushWarning = (message: string, source?: string) =>
  push("warning", message, source);

export const dismissNotification = (id: string) =>
  notificationsStore.setState((s) => ({
    entries: s.entries.filter((e) => e.id !== id),
  }));

export const clearNotifications = () =>
  notificationsStore.setState({ entries: [], lastSeenAt: Date.now() });

export const markNotificationsSeen = () =>
  notificationsStore.setState({ lastSeenAt: Date.now() });

export const useNotifications = () => notificationsStore((s) => s.entries);

export const useUnseenNotificationCount = () =>
  notificationsStore((s) =>
    s.entries.reduce((n, e) => (e.timestamp > s.lastSeenAt ? n + 1 : n), 0),
  );
