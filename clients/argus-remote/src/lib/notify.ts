/**
 * Local notifications for the phone client. The desktop decides *when* to
 * notify and forwards title/body over the gateway; here we surface them with
 * `expo-notifications` while the app is backgrounded.
 */

import * as Notifications from "expo-notifications";
import { AppState } from "react-native";
import type { RemoteNotification } from "./protocol";

type OpenAgent = (agentId: string, label: string) => void;
type Decide = (
  agentId: string,
  toolUseId: string,
  decision: "allow" | "deny",
) => void;

let openAgent: OpenAgent | null = null;
let decide: Decide | null = null;

/**
 * iOS renders a notification's buttons from a category the app registers up
 * front; the desktop only names it. Must match `PERMISSION_CATEGORY` in the
 * desktop's push dispatcher.
 */
const PERMISSION_CATEGORY = "argus.permission";

/** Register how a notification tap navigates to its agent. */
export function setNotificationOpener(fn: OpenAgent | null): void {
  openAgent = fn;
}

/** Register how an Approve/Deny button answers its prompt. */
export function setNotificationDecider(fn: Decide | null): void {
  decide = fn;
}

/**
 * Declare the Approve/Deny buttons. Both stay in the background so answering a
 * prompt never yanks you into the app.
 */
export async function registerNotificationCategories(): Promise<void> {
  try {
    await Notifications.setNotificationCategoryAsync(PERMISSION_CATEGORY, [
      {
        identifier: "approve",
        buttonTitle: "Approve",
        options: { opensAppToForeground: false },
      },
      {
        identifier: "deny",
        buttonTitle: "Deny",
        options: { opensAppToForeground: false, isDestructive: true },
      },
    ]);
  } catch {
    // Categories are best-effort; without them the notification is just plain.
  }
}

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
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

/**
 * A tap is delivered twice on a cold start — once through the listener and once
 * as `getLastNotificationResponseAsync` — so remember the last one handled.
 */
let lastHandled: string | null = null;

function responseKey(res: Notifications.NotificationResponse): string {
  const { identifier } = res.notification.request;

  return `${identifier}:${res.actionIdentifier}:${res.notification.date}`;
}

function routeResponse(res: Notifications.NotificationResponse): void {
  const key = responseKey(res);
  if (key === lastHandled) {
    return;
  }
  lastHandled = key;
  const data = res.notification.request.content.data as {
    agentId?: string;
    label?: string;
    toolUseId?: string;
  };
  const action = res.actionIdentifier;
  if ((action === "approve" || action === "deny") && data.agentId) {
    if (data.toolUseId) {
      decide?.(
        data.agentId,
        data.toolUseId,
        action === "approve" ? "allow" : "deny",
      );
    }

    return;
  }
  if (data.agentId) {
    openAgent?.(data.agentId, data.label ?? "Agent");
  }
}

/** Route a tapped notification back into the app. */
export function startNotificationRouting(): () => void {
  // A push that launched the app from cold never reaches the listener below.
  Notifications.getLastNotificationResponseAsync()
    .then((res) => {
      if (res) {
        routeResponse(res);
      }
    })
    .catch(() => {});
  const sub =
    Notifications.addNotificationResponseReceivedListener(routeResponse);

  return () => sub.remove();
}

/**
 * What this notification replaces, or null to let it stack. Mirrors
 * `collapseSubject` on the desktop: turn results supersede per agent, pending
 * approvals are distinct decisions, and MCP pushes never replace anything.
 */
function collapseIdentifier(n: RemoteNotification): string | null {
  if (n.kind === "finished" || n.kind === "failed") {
    return n.agent_id ? `agent-${n.agent_id}` : null;
  }
  if (n.kind === "permission") {
    return n.tool_use_id ? `prompt-${n.tool_use_id}` : null;
  }

  return null;
}

export function showRemoteNotification(n: RemoteNotification): void {
  // Suppress while the user is looking at the app (matches the desktop).
  if (AppState.currentState === "active") {
    return;
  }
  Notifications.scheduleNotificationAsync({
    // Same rule as the desktop's push collapse key, so an in-band alert and a
    // pushed one about the same thing replace each other instead of stacking.
    identifier: collapseIdentifier(n) ?? undefined,
    content: {
      title: n.title,
      body: n.body,
      // Same category the pushed version uses, so the buttons match whether
      // this arrived over the socket or through APNs/FCM.
      categoryIdentifier:
        n.actions.length > 0 ? PERMISSION_CATEGORY : undefined,
      data: {
        agentId: n.agent_id ?? undefined,
        label: n.title,
        toolUseId: n.tool_use_id ?? undefined,
      },
    },
    trigger: null,
  }).catch(() => {});
}
