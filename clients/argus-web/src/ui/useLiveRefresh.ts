/**
 * Poll a refresh callback while a screen is visible. The project/agent/device
 * lists have no server-push channel (unlike agent transcripts), so re-fetch on
 * an interval, plus immediately when the tab regains focus.
 */

import { useEffect } from "react";

const LIST_REFRESH_MS = 4000;

export function useLiveRefresh(enabled: boolean, refresh: () => void): void {
  useEffect(() => {
    if (!enabled) {
      return;
    }
    refresh();
    const id = setInterval(refresh, LIST_REFRESH_MS);
    const onVisible = () => {
      if (document.visibilityState === "visible") {
        refresh();
      }
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);

    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
    };
  }, [enabled, refresh]);
}
