/**
 * Fire-and-forget notification broadcast from the host to the renderer, so a
 * background failure (e.g. a failed `claude -p` during session creation)
 * doesn't silently disappear.
 *
 * Kept apart from `broadcast.ts`: that one reaches into the remote push stack,
 * and the runners that report failures must not pull the gateway in behind
 * them. This module depends on the bus and nothing else.
 */

import { emitHostEvent } from "@argus/host/bus";

export type NotificationLevel = "error" | "warning";

export interface NotificationPayload {
  level: NotificationLevel;
  message: string;
  source?: string;
}

export function broadcastNotification(payload: NotificationPayload): void {
  emitHostEvent("notification", payload);
}
