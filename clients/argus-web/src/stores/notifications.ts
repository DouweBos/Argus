/**
 * Warnings and errors from this visit, kept so a failure that flashed past
 * can still be read: the browser's `NotificationsLog`. Local to the page and
 * never sent anywhere; failed requests land here through `lib/request.ts`.
 *
 * Mirrors `AppStore`'s error hook on iOS: a dropped connection on a
 * background refresh stays out (the connection badge says so), a method the
 * computer is too old for is a warning counted once, anything else is an
 * error and a scrubbed `web_app_error`.
 */

import { create } from "zustand";
import {
  clearNotifications,
  describeError,
  dismissNotification,
  EMPTY_NOTIFICATIONS_LOG,
  isTransientError,
  markNotificationsSeen,
  type NotificationLevel,
  type NotificationsLog,
  pushNotification,
  scrubMessage,
  unseenNotificationCount,
} from "@argus/client-core";
import type { GatewayMethod } from "@argus/remote-protocol";
import { setRequestFailureSink } from "../lib/request";
import { capture } from "../telemetry/telemetry";
import { useConnectionStore } from "./connection";

interface NotificationsState extends NotificationsLog {
  push: (level: NotificationLevel, message: string, source?: string) => void;
  dismiss: (id: string) => void;
  clear: () => void;
  markSeen: () => void;
}

export const useNotificationsStore = create<NotificationsState>()((set) => ({
  ...EMPTY_NOTIFICATIONS_LOG,

  push: (level, message, source) =>
    set((s) => pushNotification(s, { level, message, source, at: Date.now() })),
  dismiss: (id) => set((s) => dismissNotification(s, id)),
  clear: () => set((s) => clearNotifications(s, Date.now())),
  markSeen: () => set((s) => markNotificationsSeen(s, Date.now())),
}));

export function useUnseenNotifications(): number {
  return useNotificationsStore(unseenNotificationCount);
}

/** Calls whose failure is an expected answer, not something that went wrong. */
const QUIET_METHODS = new Set<GatewayMethod>([
  "host.ping",
  "device.rename",
  "device.capabilities",
  "agents.limit_handoff",
  "claude_accounts.login_status",
]);

/** The method an older computer lacked, if that's why it failed. */
export function unsupportedMethod(error: unknown): string | null {
  const message = error instanceof Error ? error.message : "";
  const match = /^unknown method (\S+)/.exec(message);

  return match ? match[1] : null;
}

const unsupportedSeen = new Set<string>();

/** The area a method belongs to (`claude_accounts`), shown as the entry's source. */
function scopeOf(method: string): string {
  return method.split(".")[0] ?? method;
}

/** A failure the user should be able to find later. */
export function reportError(
  error: unknown,
  scope: string,
  { background = false }: { background?: boolean } = {},
): void {
  if (isTransientError(error)) {
    const connected = useConnectionStore.getState().connection === "ready";
    // Down or dropping: the badge already says so. A timeout while up is worth a note.
    if (background || !connected) {
      return;
    }
  }
  const { push } = useNotificationsStore.getState();
  const message = describeError(error);
  const method = unsupportedMethod(error);
  if (method) {
    push("warning", "This computer runs an older Argus without that feature.", scope);
    if (!unsupportedSeen.has(method)) {
      unsupportedSeen.add(method);
      capture("web_host_feature_unsupported", { method });
    }

    return;
  }
  push(isTransientError(error) ? "warning" : "error", message, scope);
  capture("web_app_error", { scope, message: scrubMessage(message) });
}

/** Route every failed request into the log. Call once at startup. */
/**
 * An integration the computer hasn't connected: the screen that asked says so
 * itself, so it isn't a warning to collect.
 */
export function isIntegrationNotConnected(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);

  return /\b(figma|linear)\b.*\b(isn.t|not) connected\b/i.test(message);
}

export function installNotifications(): void {
  setRequestFailureSink((method, error, background) => {
    if (QUIET_METHODS.has(method) || isIntegrationNotConnected(error)) {
      return;
    }
    reportError(error, scopeOf(method), { background });
  });
}

export function resetNotificationsForTest(): void {
  unsupportedSeen.clear();
  useNotificationsStore.setState(EMPTY_NOTIFICATIONS_LOG);
}
