/**
 * The Usage screen's keys, as `usageShortcut` in client-core defines them:
 * C / T / L for the tabs, Cmd+Shift+1–4 (Ctrl+Shift off macOS) for the range,
 * Escape for back.
 */

import { useEffect } from "react";
import {
  usageShortcut,
  type UsageRange,
  type UsageTab,
} from "@argus/client-core";
import { isTypingTarget } from "./useKeyboardShortcuts";

const IS_MAC = /Mac|iPhone|iPad/.test(navigator.userAgent);

interface Options {
  tab: UsageTab;
  onTab: (tab: UsageTab) => void;
  onRange: (range: UsageRange) => void;
  onBack: () => void;
}

export function useUsageShortcuts({ tab, onTab, onRange, onBack }: Options) {
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.repeat) {
        return;
      }
      const action = usageShortcut(e, {
        mac: IS_MAC,
        typing: isTypingTarget(e.target),
        tab,
      });
      if (!action) {
        return;
      }
      e.preventDefault();
      if (action.kind === "tab") {
        onTab(action.tab);
      } else if (action.kind === "range") {
        onRange(action.range);
      } else {
        onBack();
      }
    };
    window.addEventListener("keydown", onKeyDown);

    return () => window.removeEventListener("keydown", onKeyDown);
  }, [tab, onTab, onRange, onBack]);
}
