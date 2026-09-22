/**
 * View navigation backed by the browser history stack, so the device/browser
 * back button (and swipe-back on mobile) works. The full nav stack is stored in
 * `history.state`, so back *and* forward reconstruct exactly.
 *
 * Every view belongs to a pane. Narrow screens show only the top of the stack;
 * wide ones (tablet) show the topmost master view and the topmost detail view
 * side by side, so picking an agent leaves the project list on screen.
 */

import { useCallback, useEffect, useState } from "react";

export type View =
  | { name: "projects" }
  | { name: "project"; repoRoot: string; projectName: string }
  | { name: "agent"; agentId: string; agentLabel: string }
  | { name: "changes"; sessionId: string; label: string }
  | { name: "devices" }
  | {
      name: "device";
      deviceId: string;
      platform: "ios" | "android";
      deviceName: string;
      /** tvOS (Apple TV): pointer maps to remote dpad, not touch forwarding. */
      isTv: boolean;
    }
  | { name: "settings" };

export type Pane = "detail" | "master";

const ROOT: View[] = [{ name: "projects" }];

/** Which pane a view occupies once there is room for two. */
export function paneFor(view: View): Pane {
  return view.name === "projects" || view.name === "project"
    ? "master"
    : "detail";
}

function topOfPane(stack: View[], pane: Pane): View | null {
  for (let i = stack.length - 1; i >= 0; i -= 1) {
    if (paneFor(stack[i]) === pane) {
      return stack[i];
    }
  }

  return null;
}

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

  const view = stack[stack.length - 1];

  return {
    view,
    /** Topmost master view — always present, since the root is one. */
    masterView: topOfPane(stack, "master") ?? ROOT[0],
    /** Topmost detail view, or null when nothing has been opened yet. */
    detailView: topOfPane(stack, "detail"),
    canGoBack: stack.length > 1,
    push,
    back,
  };
}
