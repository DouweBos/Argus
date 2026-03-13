import { useEffect } from "react";
import { pauseAllWatchers, resumeAllWatchers } from "../lib/ipc";

/** Module-level focus state — readable from any code without a hook. */
let windowFocused = true;

/** Returns whether the window is currently focused. */
export function isWindowFocused(): boolean {
  return windowFocused;
}

/**
 * Pauses all file watchers when the window loses focus and resumes them on
 * regain. Must be called once at the app root (e.g. `AppShell`).
 */
export function useWindowFocus(): void {
  useEffect(() => {
    const handleBlur = () => {
      windowFocused = false;
      pauseAllWatchers().catch(() => {});
    };

    const handleFocus = () => {
      windowFocused = true;
      resumeAllWatchers().catch(() => {});
    };

    window.addEventListener("blur", handleBlur);
    window.addEventListener("focus", handleFocus);

    return () => {
      window.removeEventListener("blur", handleBlur);
      window.removeEventListener("focus", handleFocus);
    };
  }, []);
}
