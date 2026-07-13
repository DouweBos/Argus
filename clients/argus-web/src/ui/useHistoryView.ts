/**
 * View navigation backed by the browser history stack, so the device/browser
 * back button (and swipe-back on mobile) works. The full nav stack is stored in
 * `history.state`, so back *and* forward reconstruct exactly.
 */

import { useCallback, useEffect, useState } from "react";

export type View =
  | { name: "projects" }
  | { name: "project"; repoRoot: string; projectName: string }
  | { name: "agent"; agentId: string; agentLabel: string }
  | { name: "changes"; sessionId: string; label: string }
  | { name: "settings" };

const ROOT: View[] = [{ name: "projects" }];

export function useHistoryView() {
  const [stack, setStack] = useState<View[]>(ROOT);

  useEffect(() => {
    // Seed history state so popstate always has a stack to restore.
    window.history.replaceState({ stack: ROOT }, "");
    const onPop = (e: PopStateEvent) => {
      const restored = (e.state as { stack?: View[] } | null)?.stack;
      setStack(restored && restored.length > 0 ? restored : ROOT);
    };
    window.addEventListener("popstate", onPop);

    return () => window.removeEventListener("popstate", onPop);
  }, []);

  const push = useCallback((view: View) => {
    setStack((prev) => {
      const next = [...prev, view];
      window.history.pushState({ stack: next }, "");

      return next;
    });
  }, []);

  const back = useCallback(() => window.history.back(), []);

  return {
    view: stack[stack.length - 1],
    canGoBack: stack.length > 1,
    push,
    back,
  };
}
