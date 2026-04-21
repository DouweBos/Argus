/**
 * Argus navigation router.
 *
 * The URL is the single source of truth for "which screen am I on". All reads
 * derive from the current pathname via `useLocation` / `useMatch`; all writes
 * call `appNavigate(path)`. No Zustand store mirrors the route.
 *
 * ## Route inventory
 *
 * - `/`                                          → home / project picker
 * - `/activity`                                  → activity screen
 * - `/agents`                                    → global agents overview
 * - `/devices`                                   → devices screen
 * - `/notifications`                             → notifications screen
 * - `/organizations`                             → organizations list
 * - `/organizations/:organizationId`             → single organization detail
 * - `/review-queue`                              → review queue
 * - `/runtimes`                                  → runtimes overview
 * - `/settings`                                  → settings (opened as dialog)
 * - `/sessions/:sessionId`                       → session (default agent tab)
 * - `/sessions/:sessionId/agents`                → session agents view
 * - `/sessions/:sessionId/editor`                → session editor view
 * - `/sessions/:sessionId/git`                   → session git view
 */

import { useEffect } from "react";
import { useLocation, useNavigate, useNavigationType } from "react-router-dom";
import type { NavigateFunction } from "react-router-dom";

export type AppView =
  | "activity"
  | "agents"
  | "devices"
  | "home"
  | "notifications"
  | "organizations"
  | "review-queue"
  | "runtimes"
  | "session";

export type SessionPanel = "agents" | "editor" | "git" | "home";

export interface ParsedRoute {
  organizationId: string | null;
  /** Session panel (agents/editor/git). Only meaningful when view=session. */
  panel: SessionPanel;
  sessionId: string | null;
  view: AppView;
}

const VALID_PANELS: SessionPanel[] = ["agents", "editor", "git", "home"];

/** Parse a pathname into a normalised route descriptor. */
export function parseRoute(pathname: string): ParsedRoute {
  const clean = pathname.replace(/\/+$/, "") || "/";
  const segments = clean.split("/").filter(Boolean);

  if (segments.length === 0) {
    return emptyRoute("home");
  }

  if (segments[0] === "sessions" && segments[1]) {
    const panel = (segments[2] ?? "agents") as SessionPanel;

    return {
      view: "session",
      sessionId: segments[1],
      organizationId: null,
      panel: VALID_PANELS.includes(panel) ? panel : "agents",
    };
  }

  if (segments[0] === "organizations") {
    return {
      view: "organizations",
      sessionId: null,
      organizationId: segments[1] ?? null,
      panel: "agents",
    };
  }

  if (
    segments[0] === "activity" ||
    segments[0] === "agents" ||
    segments[0] === "devices" ||
    segments[0] === "notifications" ||
    segments[0] === "review-queue" ||
    segments[0] === "runtimes"
  ) {
    return emptyRoute(segments[0] as AppView);
  }

  return emptyRoute("home");
}

function emptyRoute(view: AppView): ParsedRoute {
  return { view, sessionId: null, organizationId: null, panel: "agents" };
}

/** Build a pathname for a given route descriptor. */
export function routeToPath(route: Partial<ParsedRoute>): string {
  if (route.view === "session" && route.sessionId) {
    const panel =
      route.panel && route.panel !== "agents" ? `/${route.panel}` : "";

    return `/sessions/${route.sessionId}${panel}`;
  }
  if (route.view === "organizations") {
    return route.organizationId
      ? `/organizations/${route.organizationId}`
      : "/organizations";
  }
  if (
    route.view === "activity" ||
    route.view === "agents" ||
    route.view === "devices" ||
    route.view === "notifications" ||
    route.view === "review-queue" ||
    route.view === "runtimes"
  ) {
    return `/${route.view}`;
  }

  return "/";
}

// ---------------------------------------------------------------------------
// Module-level navigator — lets non-hook code trigger navigation.
// ---------------------------------------------------------------------------

let navigator: NavigateFunction | null = null;
let lastPath: string | null = null;
const historyStack: string[] = [];
let historyCursor = -1;

/** Registers the latest `navigate` function so non-hook code can push routes. */
export function useRegisterNavigator(): void {
  const nav = useNavigate();
  const loc = useLocation();
  const navType = useNavigationType();

  useEffect(() => {
    navigator = nav;
    lastPath = loc.pathname;

    if (historyStack.length === 0) {
      historyStack.push(loc.pathname);
      historyCursor = 0;
    } else if (navType === "PUSH") {
      historyStack.length = historyCursor + 1;
      historyStack.push(loc.pathname);
      historyCursor = historyStack.length - 1;
    } else if (navType === "POP") {
      const idx = historyStack.lastIndexOf(loc.pathname);
      if (idx >= 0) {
        historyCursor = idx;
      }
    } else if (navType === "REPLACE") {
      historyStack[historyCursor] = loc.pathname;
    }

    window.dispatchEvent(
      new CustomEvent("router:historychange", {
        detail: {
          canBack: historyCursor > 0,
          canForward: historyCursor < historyStack.length - 1,
        },
      }),
    );

    return () => {
      navigator = null;
    };
  }, [nav, loc.pathname, navType]);
}

/** Navigate to a route descriptor. No-op if already there. */
export function appNavigate(
  route: Partial<ParsedRoute>,
  options?: { replace?: boolean },
): void {
  const path = routeToPath(route);
  if (path === lastPath && !options?.replace) {
    return;
  }
  lastPath = path;
  // When no router is mounted (tests, early startup) the lastPath update
  // above is still honoured by `getCurrentPath` / `getCurrentRoute`, so
  // non-hook consumers still see the navigation.
  navigator?.(path, { replace: options?.replace });
}

/** Navigate to a raw pathname (used for deep links from the main process). */
export function navigateToPath(path: string): void {
  if (!navigator) {
    return;
  }
  lastPath = path;
  navigator(path);
}

/** Current path as last observed by the registered navigator hook. */
export function getCurrentPath(): string {
  return lastPath ?? "/";
}

/** Non-hook accessor for the current parsed route. */
export function getCurrentRoute(): ParsedRoute {
  return parseRoute(getCurrentPath());
}
