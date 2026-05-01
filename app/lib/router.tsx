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
 * - `/agents`                                    → global agents overview
 * - `/devices`                                   → devices screen
 * - `/devices/:platform/:deviceKey`              → devices screen with device dialog open
 * - `/notifications`                             → notifications screen
 * - `/organizations`                             → organizations list
 * - `/organizations/:organizationId`             → single organization detail
 * - `/pull-requests`                             → outstanding PRs of interest
 * - `/pull-requests/:owner/:repo/:number`        → individual PR detail
 * - `/review-queue`                              → review queue
 * - `/runtimes`                                  → runtimes overview
 * - `/settings`                                  → settings (opened as dialog)
 * - `/sessions/:sessionId`                       → session (default agent tab)
 * - `/sessions/:sessionId/agents`                → session agents view
 * - `/sessions/:sessionId/editor`                → session editor view
 * - `/sessions/:sessionId/git`                   → session git view
 * - `/sessions/:sessionId/git/:gitView`           → git view sub-screen
 *                                                  (working|branch|history|stashes|
 *                                                  reflog|conflicts|branches|tags|
 *                                                  remotes|submodules|worktrees|
 *                                                  pull-requests|branches-review|
 *                                                  compare|blame|interactive-rebase|
 *                                                  settings)
 *                                                  ?left=...&right=... for compare
 *                                                  ?path=...&ref=... for blame
 *                                                  ?from=... for interactive-rebase
 *
 * Project-root git client. Project-root sessions (`session.kind === "project_root"`)
 * reuse the same `/sessions/:sessionId/git/...` pattern; the `scope="project"`
 * mount is selected on the renderer side from the session record.
 */

import { useEffect } from "react";
import { useLocation, useNavigate, useNavigationType } from "react-router-dom";
import type { NavigateFunction } from "react-router-dom";
import { capturePageview } from "./telemetry";

export type AppView =
  | "agents"
  | "devices"
  | "home"
  | "notifications"
  | "organizations"
  | "pull-request-detail"
  | "pull-requests"
  | "review-queue"
  | "runtimes"
  | "session";

export type SessionPanel = "agents" | "editor" | "git" | "home";

export type GitSubView =
  | "bisect"
  | "blame"
  | "branch"
  | "branches-review"
  | "branches"
  | "compare"
  | "conflicts"
  | "history"
  | "hooks"
  | "interactive-rebase"
  | "pull-requests"
  | "reflog"
  | "settings"
  | "stashes"
  | "submodules"
  | "tags"
  | "working";

const VALID_GIT_SUB_VIEWS: GitSubView[] = [
  "bisect",
  "blame",
  "branch",
  "branches",
  "branches-review",
  "compare",
  "conflicts",
  "history",
  "hooks",
  "interactive-rebase",
  "pull-requests",
  "reflog",
  "settings",
  "stashes",
  "submodules",
  "tags",
  "working",
];

export interface PullRequestRef {
  number: number;
  owner: string;
  repo: string;
}

export interface ParsedRoute {
  /**
   * Trailing ref name for ref-scoped git sub-views. When `gitView` is
   * `"branches"` or `"tags"` the URL may carry an additional segment naming
   * a specific branch/tag (e.g. `/git/branches/feature%2Ffoo`). Drives the
   * single-selection model in the git sidebar — the highlighted item is the
   * one whose route exactly matches `gitView` + `gitRefName`.
   */
  gitRefName: string | null;
  /** Sub-view inside the git panel (working/branches/history/…). */
  gitView: GitSubView | null;
  organizationId: string | null;
  /** Session panel (agents/editor/git). Only meaningful when view=session. */
  panel: SessionPanel;
  /** Identifies which PR to show when view === "pull-request-detail". */
  pr: PullRequestRef | null;
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
    const validPanel: SessionPanel = VALID_PANELS.includes(panel)
      ? panel
      : "agents";
    let gitView: GitSubView | null = null;
    let gitRefName: string | null = null;
    if (validPanel === "git" && segments[3]) {
      const candidate = segments[3] as GitSubView;
      if (VALID_GIT_SUB_VIEWS.includes(candidate)) {
        gitView = candidate;
        // Ref-scoped sub-views carry an additional URL segment naming the
        // selected branch/tag. Anything else past segments[3] is ignored.
        if ((gitView === "branches" || gitView === "tags") && segments[4]) {
          try {
            gitRefName = decodeURIComponent(segments[4]);
          } catch {
            gitRefName = segments[4];
          }
        }
      }
    }

    return {
      view: "session",
      sessionId: segments[1],
      organizationId: null,
      panel: validPanel,
      gitView,
      gitRefName,
      pr: null,
    };
  }

  if (segments[0] === "organizations") {
    return {
      view: "organizations",
      sessionId: null,
      organizationId: segments[1] ?? null,
      panel: "agents",
      gitView: null,
      gitRefName: null,
      pr: null,
    };
  }

  if (
    segments[0] === "pull-requests" &&
    segments.length >= 4 &&
    segments[1] &&
    segments[2] &&
    segments[3]
  ) {
    const number = Number.parseInt(segments[3], 10);
    if (Number.isFinite(number)) {
      return {
        view: "pull-request-detail",
        sessionId: null,
        organizationId: null,
        panel: "agents",
        gitView: null,
        gitRefName: null,
        pr: {
          owner: decodeURIComponent(segments[1]),
          repo: decodeURIComponent(segments[2]),
          number,
        },
      };
    }
  }

  if (
    segments[0] === "agents" ||
    segments[0] === "devices" ||
    segments[0] === "notifications" ||
    segments[0] === "pull-requests" ||
    segments[0] === "review-queue" ||
    segments[0] === "runtimes"
  ) {
    return emptyRoute(segments[0] as AppView);
  }

  return emptyRoute("home");
}

function emptyRoute(view: AppView): ParsedRoute {
  return {
    view,
    sessionId: null,
    organizationId: null,
    panel: "agents",
    gitView: null,
    gitRefName: null,
    pr: null,
  };
}

/**
 * Sanitised route template for the current pathname — never contains IDs,
 * names, or any other dynamic segment that could leak project / session /
 * org / repo identifiers into telemetry.
 *
 * Example: `/sessions/abc-123/editor` → `/sessions/:sessionId/editor`.
 */
export function routePattern(pathname: string): string {
  const route = parseRoute(pathname);
  switch (route.view) {
    case "home":
      return "/";
    case "agents":
    case "devices":
    case "notifications":
    case "pull-requests":
    case "review-queue":
    case "runtimes":
      return `/${route.view}`;
    case "session":
      return route.panel === "agents"
        ? "/sessions/:sessionId"
        : `/sessions/:sessionId/${route.panel}`;
    case "organizations":
      return route.organizationId
        ? "/organizations/:organizationId"
        : "/organizations";
    case "pull-request-detail":
      return "/pull-requests/:owner/:repo/:number";
  }
}

/** Build a pathname for a given route descriptor. */
export function routeToPath(route: Partial<ParsedRoute>): string {
  if (route.view === "session" && route.sessionId) {
    const panel =
      route.panel && route.panel !== "agents" ? `/${route.panel}` : "";
    const gitView =
      route.panel === "git" && route.gitView ? `/${route.gitView}` : "";
    const gitRef =
      route.panel === "git" &&
      (route.gitView === "branches" || route.gitView === "tags") &&
      route.gitRefName
        ? `/${encodeURIComponent(route.gitRefName)}`
        : "";

    return `/sessions/${route.sessionId}${panel}${gitView}${gitRef}`;
  }
  if (route.view === "organizations") {
    return route.organizationId
      ? `/organizations/${route.organizationId}`
      : "/organizations";
  }
  if (route.view === "pull-request-detail" && route.pr) {
    const { owner, repo, number } = route.pr;

    return `/pull-requests/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/${number}`;
  }
  if (
    route.view === "agents" ||
    route.view === "devices" ||
    route.view === "notifications" ||
    route.view === "pull-requests" ||
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

    capturePageview(routePattern(loc.pathname));

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
