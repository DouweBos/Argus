/**
 * Argus navigation router.
 *
 * Uses react-router-dom's MemoryRouter so the in-renderer URL is the source of
 * truth for "which screen am I on" — Zustand stores continue to own data state
 * (session list, agents, terminals), but the current view and the selected
 * session id are reflected in the URL so back/forward history and deep links
 * work.
 *
 * ## Route inventory
 *
 * - `/`                                          → home / project picker
 * - `/activity`                                  → activity screen
 * - `/agents`                                    → global agents overview
 * - `/devices`                                   → devices screen
 * - `/organizations`                             → organizations list
 * - `/organizations/:organizationId`             → single organization detail
 * - `/review-queue`                              → review queue
 * - `/settings`                                  → settings (opened as dialog)
 * - `/sessions/:sessionId`                   → session (default agent tab)
 * - `/sessions/:sessionId/agents`            → session agents view
 * - `/sessions/:sessionId/editor`            → session editor view
 * - `/sessions/:sessionId/git`               → session git view
 *
 * `parseRoute` turns any incoming URL into a normalised `{ view, sessionId,
 * organizationId, panel }` descriptor; `syncRouteToStores` reflects that
 * descriptor into the Zustand stores that still drive rendering. This keeps
 * the migration pragmatic — new routes are first-class but existing components
 * continue to read the same selectors they always did.
 */

import type { CenterView } from "../stores/centerViewStore";
import type { CenterView as EditorCenterView } from "../stores/editorStore";
import { useEffect } from "react";
import { useLocation, useNavigate, useNavigationType } from "react-router-dom";
import type { NavigateFunction } from "react-router-dom";
import {
  setCenterView,
  openOrganization,
  clearSelectedOrganization,
} from "../stores/centerViewStore";
import { setActiveCenterView, getEditorState } from "../stores/editorStore";
import { getSessionState, selectSession } from "../stores/sessionStore";
import { persistRoute } from "./routePersistence";

export type AppView =
  | "activity"
  | "agents"
  | "devices"
  | "home"
  | "notifications"
  | "organizations"
  | "review-queue"
  | "session";

export interface ParsedRoute {
  organizationId: string | null;
  /** Session panel (agents/editor/git). Only meaningful when view=session. */
  panel: EditorCenterView;
  sessionId: string | null;
  view: AppView;
}

/**
 * Parse a pathname (e.g. `/sessions/abc/git`) into a normalised route
 * descriptor. Unknown paths fall back to the home route.
 */
export function parseRoute(pathname: string): ParsedRoute {
  const clean = pathname.replace(/\/+$/, "") || "/";
  const segments = clean.split("/").filter(Boolean);

  if (segments.length === 0) {
    return emptyRoute("home");
  }

  if (segments[0] === "sessions" && segments[1]) {
    const panel = (segments[2] ?? "agents") as EditorCenterView;
    const valid: EditorCenterView[] = ["agents", "editor", "git", "home"];

    return {
      view: "session",
      sessionId: segments[1],
      organizationId: null,
      panel: valid.includes(panel) ? panel : "agents",
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
    segments[0] === "review-queue"
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
    route.view === "review-queue"
  ) {
    return `/${route.view}`;
  }

  return "/";
}

/** Map the non-session views to the legacy CenterView enum. */
function toCenterView(view: AppView): CenterView {
  if (view === "session") {
    // Session-view routes don't drive centerView; the store value is
    // ignored while a session is selected.
    return "home";
  }

  return view;
}

/**
 * Reflect a parsed route into the Zustand stores that still own rendering
 * decisions. Called from `useRouteSync` on every location change.
 */
export function syncRouteToStores(route: ParsedRoute): void {
  const { selectedId } = getSessionState();

  if (route.view === "session") {
    if (selectedId !== route.sessionId) {
      selectSession(route.sessionId);
    }
    if (getEditorState().activeCenterView !== route.panel) {
      setActiveCenterView(route.panel);
    }

    return;
  }

  if (selectedId !== null) {
    selectSession(null);
  }

  if (route.view === "organizations" && route.organizationId) {
    openOrganization(route.organizationId);

    return;
  }

  clearSelectedOrganization();
  setCenterView(toCenterView(route.view));
}

/** Hook: keep stores in sync with the current URL. */
export function useRouteSync(): void {
  const location = useLocation();
  const navType = useNavigationType();
  useEffect(() => {
    syncing = true;
    try {
      syncRouteToStores(parseRoute(location.pathname));
    } finally {
      syncing = false;
    }

    // Update the history cursor so the back/forward buttons know whether
    // they can fire. PUSH grows the stack; POP just moves the cursor.
    if (historyStack.length === 0) {
      // Seed the stack with the initial entry on first sync — react-router
      // reports navType="POP" on mount, so without this the home screen
      // would never be recorded and back/forward couldn't return to it.
      historyStack.push(location.pathname);
      historyCursor = 0;
    } else if (navType === "PUSH") {
      historyStack.length = historyCursor + 1;
      historyStack.push(location.pathname);
      historyCursor = historyStack.length - 1;
    } else if (navType === "POP") {
      const idx = historyStack.lastIndexOf(location.pathname);
      if (idx >= 0) {
        historyCursor = idx;
      }
    } else if (navType === "REPLACE") {
      historyStack[historyCursor] = location.pathname;
    }

    window.dispatchEvent(
      new CustomEvent("router:historychange", {
        detail: {
          canBack: historyCursor > 0,
          canForward: historyCursor < historyStack.length - 1,
        },
      }),
    );

    persistRoute(location.pathname);
  }, [location.pathname, navType]);
}

let navigator: NavigateFunction | null = null;
let syncing = false;
let lastPath: string | null = null;
const historyStack: string[] = [];
let historyCursor = -1;

/** Registers the latest `navigate` function so non-hook code can push routes. */
export function useRegisterNavigator(): void {
  const nav = useNavigate();
  const loc = useLocation();
  useEffect(() => {
    navigator = nav;
    lastPath = loc.pathname;

    return () => {
      navigator = null;
    };
  }, [nav, loc.pathname]);
}

/**
 * Push a new route entry onto the history stack. No-op while `useRouteSync`
 * is reconciling the URL back into the stores (prevents loops) and when the
 * target path equals the current one.
 */
export function pushRoute(route: Partial<ParsedRoute>): void {
  if (syncing || !navigator) {
    return;
  }
  const path = routeToPath(route);
  if (path === lastPath) {
    return;
  }
  lastPath = path;
  navigator(path);
}

/** Replace the current route (no new history entry). */
export function replaceRoute(route: Partial<ParsedRoute>): void {
  if (syncing || !navigator) {
    return;
  }
  const path = routeToPath(route);
  lastPath = path;
  navigator(path, { replace: true });
}

/** Imperative navigation for deep links coming from main process. */
export function navigateToPath(path: string): void {
  if (!navigator) {
    return;
  }
  lastPath = path;
  navigator(path);
}

/** Current path as last observed by the registered navigator hook. */
export function getCurrentPath(): string | null {
  return lastPath;
}
