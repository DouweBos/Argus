/**
 * Subscribe to `notification` events from the main process and route them
 * into the user-visible notifications store. The backend uses this channel
 * to surface background failures — e.g. a failed `claude -p` call during
 * session creation — that would otherwise only appear in the electron
 * console.
 */

import { pushError, pushWarning } from "../stores/notificationsStore";
import { listen } from "./events";

interface NotificationEvent {
  level: "error" | "warning";
  message: string;
  source?: string;
}

let initialized = false;

export function initNotificationsListener(): void {
  if (initialized) {
    return;
  }
  initialized = true;

  listen<NotificationEvent>("notification", (event) => {
    const { level, message, source } = event.payload;
    if (level === "error") {
      pushError(message, source);
    } else {
      pushWarning(message, source);
    }
  });
}
