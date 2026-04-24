/**
 * Fire-and-forget notification broadcast from the main process to the
 * renderer. The renderer routes these into the user-visible notifications
 * store so background failures (e.g. a failed `claude -p` call during
 * session creation) don't silently disappear.
 */

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
