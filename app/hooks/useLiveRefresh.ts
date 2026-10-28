import { useEffect, useRef } from "react";

/**
 * Re-run `refresh` every `intervalMs` while mounted and whenever the window
 * comes back into focus or view, so lists without a push channel stay current.
 */
export function useLiveRefresh(refresh: () => void, intervalMs: number): void {
  const latest = useRef(refresh);
  useEffect(() => {
    latest.current = refresh;
  });

  useEffect(() => {
    const run = () => latest.current();
    const onVisible = () => {
      if (document.visibilityState === "visible") {
        run();
      }
    };
    const timer = window.setInterval(run, intervalMs);
    window.addEventListener("focus", run);
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", run);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [intervalMs]);
}
