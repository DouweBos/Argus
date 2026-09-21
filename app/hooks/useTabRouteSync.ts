/**
 * Keeps the active window tab pointed at the URL, and puts the saved tab back
 * on screen at launch. The URL stays the source of truth — the tab only
 * remembers where it has been so switching tabs can restore it.
 */

import { useEffect, useRef } from "react";
import { useLocation } from "react-router-dom";
import {
  getActiveTab,
  recordNavigation,
  restoreActiveTab,
} from "../stores/tabStore";

export function useTabRouteSync(): void {
  const { pathname, search } = useLocation();
  const restored = useRef(false);

  useEffect(() => {
    const path = `${pathname}${search}`;
    if (!restored.current) {
      restored.current = true;
      // The window opens on "/" before the saved tab is applied; recording
      // that would overwrite the route we are about to restore.
      restoreActiveTab();
      if (getActiveTab()?.path !== path) {
        return;
      }
    }
    recordNavigation(path);
  }, [pathname, search]);
}
