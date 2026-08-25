/**
 * Web notifications for the remote client — the browser-side mirror of the
 * desktop's `agentNotifications`. The desktop decides *when* to notify and
 * forwards title/body over the gateway; here we surface them via the Web
 * Notification API when this tab isn't the one the user is looking at.
 *
 * While a tab is alive these fire in the page; once every tab is closed the
 * service worker in `sw.js` takes over via Web Push. iOS Safari only exposes
 * either API to installed PWAs.
 */

import type { RemoteNotification } from "./protocol";

type OpenAgent = (agentId: string, label: string) => void;

let openAgent: OpenAgent | null = null;

/** Register how a notification click navigates to its agent. */
export function setNotificationOpener(fn: OpenAgent | null): void {
  openAgent = fn;
}

/** Navigate to an agent, e.g. from a service-worker notification click. */
export function routeAgentOpen(agentId: string, label: string): void {
  openAgent?.(agentId, label);
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
  const data = {
    agentId: n.agent_id ?? undefined,
    label: n.title,
    toolUseId: n.tool_use_id ?? undefined,
    kind: n.kind,
  };
  const options: NotificationOptions = {
    body: n.body,
    requireInteraction: n.kind === "permission",
    // Same tag as the desktop's push collapse key, so an in-band alert and a
    // pushed one about the same agent replace each other instead of stacking.
    tag: n.agent_id ? `agent-${n.agent_id}` : undefined,
    data,
  };

  // Only the service worker can render buttons, so a notification with quick
  // actions goes through it — that also keeps its click handling identical to
  // a pushed one. Everything else stays on the plain page notification.
  if (n.actions.length > 0 && "serviceWorker" in navigator) {
    void navigator.serviceWorker
      .getRegistration()
      .then((reg) => {
        if (!reg?.active) {
          throw new Error("no active service worker");
        }

        return reg.showNotification(n.title, {
          ...options,
          actions: n.actions.map((a) => ({ action: a.id, title: a.title })),
        } as NotificationOptions);
      })
      .catch(() => showPageNotification(n, options));

    return;
  }
  showPageNotification(n, options);
}

function showPageNotification(
  n: RemoteNotification,
  options: NotificationOptions,
): void {
  const notification = new Notification(n.title, options);
  notification.onclick = () => {
    window.focus();
    if (n.agent_id) {
      openAgent?.(n.agent_id, n.title);
    }
    notification.close();
  };
}
