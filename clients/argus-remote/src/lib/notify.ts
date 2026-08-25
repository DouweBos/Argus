/**
 * Local notifications for the phone client. The desktop decides *when* to
 * notify and forwards title/body over the gateway; here we surface them with
 * `expo-notifications` while the app is backgrounded.
 */

import * as Notifications from "expo-notifications";
import { AppState } from "react-native";
import type { RemoteNotification } from "./protocol";

type OpenAgent = (agentId: string, label: string) => void;

let openAgent: OpenAgent | null = null;

/** Register how a notification tap navigates to its agent. */
export function setNotificationOpener(fn: OpenAgent | null): void {
  openAgent = fn;
}

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: false,
    shouldSetBadge: false,
  }),
});

export async function requestNotificationPermission(): Promise<boolean> {
  const current = await Notifications.getPermissionsAsync();
  if (current.granted) {
    return true;
  }
  if (!current.canAskAgain) {
    return false;
  }
  const next = await Notifications.requestPermissionsAsync();

  return next.granted;
}

export async function notificationStatus(): Promise<
  "blocked" | "granted" | "unset"
> {
  const current = await Notifications.getPermissionsAsync();
  if (current.granted) {
    return "granted";
  }

  return current.canAskAgain ? "unset" : "blocked";
}

/** Route a tapped notification back into the app. */
export function startNotificationRouting(): () => void {
  const sub = Notifications.addNotificationResponseReceivedListener((res) => {
    const data = res.notification.request.content.data as {
      agentId?: string;
      label?: string;
    };
    if (data.agentId) {
      openAgent?.(data.agentId, data.label ?? "Agent");
    }
  });

  return () => sub.remove();
}

export function showRemoteNotification(n: RemoteNotification): void {
  // Suppress while the user is looking at the app (matches the desktop).
  if (AppState.currentState === "active") {
    return;
  }
  Notifications.scheduleNotificationAsync({
    content: {
      title: n.title,
      body: n.body,
      data: { agentId: n.agent_id ?? undefined, label: n.title },
    },
    trigger: null,
  }).catch(() => {});
}
