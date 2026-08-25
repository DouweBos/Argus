/**
 * Poll a refresh callback while a screen is mounted. Project/agent/device lists
 * have no server-push channel (unlike transcripts), so re-fetch on an interval
 * plus immediately when the app returns to the foreground.
 */

import { useEffect } from "react";
import { AppState } from "react-native";

const LIST_REFRESH_MS = 4000;

export function useLiveRefresh(enabled: boolean, refresh: () => void): void {
  useEffect(() => {
    if (!enabled) {
      return;
    }
    refresh();
    const id = setInterval(refresh, LIST_REFRESH_MS);
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "active") {
        refresh();
      }
    });

    return () => {
      clearInterval(id);
      sub.remove();
    };
  }, [enabled, refresh]);
}
