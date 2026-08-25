/**
 * Fire-and-forget notification broadcast from the main process to the
 * renderer. The renderer routes these into the user-visible notifications
 * store so background failures (e.g. a failed `claude -p` call during
 * session creation) don't silently disappear.
 */

import type { RemoteNotificationAction } from "./actions";
import { broadcastToRenderers } from "../../broadcast";
import { getMainWindow } from "../../mainWindow";
import { dispatchRemotePush } from "../remote/push/dispatch";

export {
  permissionActions,
  type NotificationActionId,
  type RemoteNotificationAction,
} from "./actions";

export type NotificationLevel = "error" | "warning";

export interface NotificationPayload {
  level: NotificationLevel;
  message: string;
  source?: string;
}

export function broadcastNotification(payload: NotificationPayload): void {
  getMainWindow()?.webContents.send("notification", payload);
}

/** A user-facing notification, mirrored to every surface that can show it. */
export interface RemoteNotificationPayload {
  agent_id: string | null;
  session_id: string | null;
  /** The prompt an action answers. Only set for `kind: "permission"`. */
  tool_use_id: string | null;
  kind: "failed" | "finished" | "permission" | "push";
  title: string;
  body: string;
  /** Quick actions, identical on the desktop, the phone, and in browsers. */
  actions: RemoteNotificationAction[];
}

/**
 * Fan a notification out to every connected remote device. Routed through
 * `broadcastToRenderers` so the gateway's broadcast tap picks it up; the
 * desktop renderer has no listener for this channel and ignores it.
 *
 * Devices that are *not* connected can't see that event, so they get a real
 * APNs/FCM/Web Push instead — sent straight from this machine, no relay server.
 */
export function broadcastRemoteNotification(
  payload: RemoteNotificationPayload,
): void {
  broadcastToRenderers("remote:notification", payload);
  dispatchRemotePush(payload);
}
