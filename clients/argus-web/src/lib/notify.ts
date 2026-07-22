/**
 * Web notifications for the remote client — the browser-side mirror of the
 * desktop's `agentNotifications`. The desktop decides *when* to notify and
 * forwards title/body over the gateway; here we surface them via the Web
 * Notification API when this tab isn't the one the user is looking at.
 *
 * Foreground-only: there is no service worker, so notifications fire while the
 * page is alive. iOS Safari only exposes the API to installed PWAs.
 */

import type { RemoteNotification } from "./protocol";

type OpenAgent = (agentId: string, label: string) => void;

let openAgent: OpenAgent | null = null;

/** Register how a notification click navigates to its agent. */
export function setNotificationOpener(fn: OpenAgent | null): void {
  openAgent = fn;
}

export function notificationsSupported(): boolean {
  return typeof Notification !== "undefined";
}

/** Ask for permission (needs a user gesture on some browsers). */
export async function requestNotificationPermission(): Promise<NotificationPermission> {
  if (!notificationsSupported()) {
    return "denied";
  }
  try {
    return await Notification.requestPermission();
  } catch {
    return Notification.permission;
  }
}

function shouldShow(): boolean {
  if (!notificationsSupported() || Notification.permission !== "granted") {
    return false;
  }
  // Suppress while the user is actively looking at this tab (matches desktop).
  if (typeof document !== "undefined") {
    if (document.visibilityState === "visible" && document.hasFocus()) {
      return false;
    }
  }

  return true;
}

export function showRemoteNotification(n: RemoteNotification): void {
  if (!shouldShow()) {
    return;
  }
  const notification = new Notification(n.title, {
    body: n.body,
    requireInteraction: n.kind === "permission",
    tag: n.agent_id ?? undefined,
  });
  notification.onclick = () => {
    window.focus();
    if (n.agent_id) {
      openAgent?.(n.agent_id, n.title);
    }
    notification.close();
  };
}
