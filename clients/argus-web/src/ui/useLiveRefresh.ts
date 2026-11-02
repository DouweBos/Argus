/**
 * Poll a refresh callback while a screen is visible, plus immediately when the
 * tab regains focus. Lists the host announces (`sessions.changed`,
 * `projects.changed`, `agent.status`) poll slowly, as a backstop for a dropped
 * event or an older computer; device lists have no push and poll fast.
 */

import { useEffect } from "react";

const LIST_REFRESH_MS = 4000;

/** For lists the host pushes changes to. */
export const PUSHED_LIST_REFRESH_MS = 30_000;

export function useLiveRefresh(
  enabled: boolean,
  refresh: () => void,
  intervalMs: number = LIST_REFRESH_MS,
): void {
  useEffect(() => {
    if (!enabled) {
      return;
    }
    refresh();
    const id = setInterval(refresh, intervalMs);
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
  }, [enabled, refresh, intervalMs]);
}
