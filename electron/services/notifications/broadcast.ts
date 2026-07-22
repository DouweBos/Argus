/**
 * Fire-and-forget notification broadcast from the main process to the
 * renderer. The renderer routes these into the user-visible notifications
 * store so background failures (e.g. a failed `claude -p` call during
 * session creation) don't silently disappear.
 */

import { broadcastToRenderers } from "../../broadcast";
import { getMainWindow } from "../../main";

export type NotificationLevel = "error" | "warning";

export interface NotificationPayload {
  level: NotificationLevel;
  message: string;
  source?: string;
}

export function broadcastNotification(payload: NotificationPayload): void {
  getMainWindow()?.webContents.send("notification", payload);
}

/** A user-facing notification mirrored to connected remote devices. */
export interface RemoteNotificationPayload {
  agent_id: string | null;
  session_id: string | null;
  kind: "failed" | "finished" | "permission" | "push";
  title: string;
  body: string;
}

/**
 * Fan a notification out to every connected remote device. Routed through
 * `broadcastToRenderers` so the gateway's broadcast tap picks it up; the
 * desktop renderer has no listener for this channel and ignores it.
 */
export function broadcastRemoteNotification(
  payload: RemoteNotificationPayload,
): void {
  broadcastToRenderers("remote:notification", payload);
}
