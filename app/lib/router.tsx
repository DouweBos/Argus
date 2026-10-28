/**
 * Argus navigation router.
 *
 * The URL is the single source of truth for "which screen am I on". All reads
 * derive from the current pathname via `useLocation` / `useMatch`; all writes
 * call `appNavigate(path)`. No Zustand store mirrors the route.
 *
 * ## Route inventory
 *
 * Every URL may carry `?host=<hostId>` naming the machine the view reads from
 * (omitted for this Mac). Several hosts can be attached at once, so which one
 * a screen is showing is part of what you are looking at.
 *
 * - `/`                                          → home / project picker
 * - `/agents`                                    → global agents overview
 * - `/automations`                               → automations list
 * - `/automations/quick`                         → ad-hoc runs: compose one, and their history
 * - `/automations/quick/runs/:runId`             → a single ad-hoc run
 * - `/automations/:automationId`                 → automation config + run history
 * - `/automations/:automationId/runs/:runId`     → a single automation run
 * - `/design?url=<figma url>[&session=<id>]`     → design viewer for a Figma frame
 * - `/devices`                                   → devices screen
 * - `/devices/:platform/:deviceKey`              → devices screen with device dialog open
 * - `/inbox`                                     → the briefing: what Argus wants you to decide
 * - `/inbox/proposals/:proposalId`               → one proposal, in full
 * - `/notifications`                             → notifications screen
 * - `/pull-requests`                             → outstanding PRs of interest
 * - `/pull-requests/:owner/:repo/:number`        → individual PR detail
 * - `/runtimes`                                  → runtimes overview
 * - `/usage`                                     → usage, on the plan limits tab
 * - `/usage/cost`, `/usage/tokens`               → usage, estimated cost / tokens
 *                                                  ?range=24h|7d|30d|90d (default 30d)
 * - `/settings`                                  → settings (opened as dialog)
 * - `/sessions/:sessionId`                       → session (default home tab)
 * - `/sessions/:sessionId/agents`                → session agents view
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

import type { UsageRange } from "./types";
import { useEffect } from "react";
import { useLocation, useNavigate, useNavigationType } from "react-router-dom";
import type { NavigateFunction } from "react-router-dom";
import {
  type DesignRouteFields,
  designPathname,
  designRouteFields,
} from "./routerDesign";
import { capturePageview } from "./telemetry";
import { LOCAL_HOST_ID, type HostId } from "./transport/hostId";

export type AppView =
  | "agents"
  | "automations"
  | "design"
  | "devices"
  | "home"
  | "inbox"
  | "issues"
  | "notifications"
  | "pull-request-detail"
  | "pull-requests"
  | "runtimes"
  | "session"
  | "usage";

export type SessionPanel = "agents" | "git" | "home";

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

/** Tabs of the usage screen. `limits` is the default and owns bare `/usage`. */
export type UsageTab = "cost" | "limits" | "tokens";

const VALID_USAGE_TABS: UsageTab[] = ["cost", "limits", "tokens"];

export type { UsageRange };

/** Time window of the cost and tokens tabs; `30d` owns the bare URL. */
export const DEFAULT_USAGE_RANGE: UsageRange = "30d";

const VALID_USAGE_RANGES: UsageRange[] = ["24h", "7d", "30d", "90d"];

export interface PullRequestRef {
  number: number;
  owner: string;
  repo: string;
}

export interface ParsedRoute extends DesignRouteFields {
  /** Which automation is open. Only meaningful when view === "automations". */
  automationId: string | null;
  /**
   * The ad-hoc surface at `/automations/quick`. Ad-hoc runs have no automation
   * to hang off, so they get their own segment rather than borrowing the
   * synthetic id the host runs them under.
   */
  automationQuick: boolean;
  /** Which run of that automation is open, if any. */
  automationRunId: string | null;
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
  /**
   * Which attached host the view reads from. `?host=<id>` in the URL;
   * `LOCAL_HOST_ID` (this Mac) when absent. Two hosts may hold a project at
   * the same path, so screens that are not pinned to a session read this to
   * know whose projects, devices and agents they are showing.
   */
  hostId: HostId;
  /** The issue open over the Issues screen (`STR-123`), if any. */
  issueRef: string | null;
  /** Whose issues the Issues screen lists. Only meaningful when view=issues. */
  issueScope: IssueScope;
  /** Session panel (agents/git/home). Only meaningful when view=session. */
  panel: SessionPanel;
  /** Identifies which PR to show when view === "pull-request-detail". */
  pr: PullRequestRef | null;
  /** Which proposal is open. Only meaningful when view === "inbox". */
  proposalId: string | null;
  sessionId: string | null;
  /** `?range=` of the cost and tokens tabs; null everywhere else. */
  usageRange: UsageRange | null;
  /** Which usage tab is open. Only meaningful when view === "usage". */
  usageTab: UsageTab | null;
  view: AppView;
}

const VALID_PANELS: SessionPanel[] = ["agents", "git", "home"];

export type IssueScope = "assigned" | "created" | "subscribed";
const ISSUE_SCOPES: IssueScope[] = ["assigned", "created", "subscribed"];

/** `/issues[/<scope>][/<IDENTIFIER>]` — the bare path is your assigned issues. */
function issueRouteFields(pathname: string): {
  issueRef: string | null;
  issueScope: IssueScope;
} {
  const [first, second, third] = pathname.split("/").filter(Boolean);
  if (first !== "issues") {
    return { issueRef: null, issueScope: "assigned" };
  }
  const scope = ISSUE_SCOPES.find((s) => s === second);

  return {
    issueScope: scope ?? "assigned",
    issueRef: scope ? (third ?? null) : (second ?? null),
  };
}

/**
 * Parse a URL (pathname, optionally with a query string) into a normalised
 * route descriptor. `?host=` names the attached host the view reads from.
 */
export function parseRoute(url: string): ParsedRoute {
  const queryAt = url.indexOf("?");
  const pathname = queryAt === -1 ? url : url.slice(0, queryAt);
  const search = queryAt === -1 ? "" : url.slice(queryAt + 1);
  const params = new URLSearchParams(search);
  const hostId = params.get("host");
  const route = parsePathname(pathname);

  return {
    ...route,
    ...issueRouteFields(pathname),
    ...designRouteFields(pathname, params),
    hostId: hostId && hostId.length > 0 ? hostId : LOCAL_HOST_ID,
    usageRange: usageRangeFor(route.usageTab, params.get("range")),
  };
}

/** Fields `parsePathname` leaves to the query and sub-route helpers. */
type NonPathFields =
  | keyof DesignRouteFields
  | "hostId"
  | "issueRef"
  | "issueScope"
  | "usageRange";

function usageRangeFor(
  tab: UsageTab | null,
  raw: string | null,
): UsageRange | null {
  if (tab !== "cost" && tab !== "tokens") {
    return null;
  }

  return VALID_USAGE_RANGES.find((r) => r === raw) ?? DEFAULT_USAGE_RANGE;
}

function parsePathname(pathname: string): Omit<ParsedRoute, NonPathFields> {
  const clean = pathname.replace(/\/+$/, "") || "/";
  const segments = clean.split("/").filter(Boolean);

  if (segments.length === 0) {
    return emptyRoute("home");
  }

  if (segments[0] === "automations") {
    const quick = segments[1] === "quick";
    const automationId =
      !quick && segments[1] ? decodeSegment(segments[1]) : null;
    const runId =
      (quick || automationId) && segments[2] === "runs" && segments[3]
        ? decodeSegment(segments[3])
        : null;

    return {
      ...emptyRoute("automations"),
      automationId,
      automationQuick: quick,
      automationRunId: runId,
    };
  }

  if (segments[0] === "inbox") {
    const proposalId =
      segments[1] === "proposals" && segments[2]
        ? decodeSegment(segments[2])
        : null;

    return { ...emptyRoute("inbox"), proposalId };
  }

  if (segments[0] === "usage") {
    const candidate = segments[1] as UsageTab | undefined;
    const usageTab =
      candidate && VALID_USAGE_TABS.includes(candidate) ? candidate : "limits";

    return { ...emptyRoute("usage"), usageTab };
  }

  if (segments[0] === "sessions" && segments[1]) {
    const panel = (segments[2] ?? "home") as SessionPanel;
    const validPanel: SessionPanel = VALID_PANELS.includes(panel)
      ? panel
      : "home";
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
      automationId: null,
      automationQuick: false,
      automationRunId: null,
      sessionId: segments[1],
      panel: validPanel,
      gitView,
      gitRefName,
      proposalId: null,
      pr: null,
      usageTab: null,
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
        automationId: null,
        automationQuick: false,
        automationRunId: null,
        sessionId: null,
        panel: "agents",
        gitView: null,
        gitRefName: null,
        proposalId: null,
        pr: {
          owner: decodeURIComponent(segments[1]),
          repo: decodeURIComponent(segments[2]),
          number,
        },
        usageTab: null,
      };
    }
  }

  if (
    segments[0] === "agents" ||
    segments[0] === "design" ||
    segments[0] === "devices" ||
    segments[0] === "issues" ||
    segments[0] === "notifications" ||
    segments[0] === "pull-requests" ||
    segments[0] === "runtimes"
  ) {
    return emptyRoute(segments[0] as AppView);
  }

  return emptyRoute("home");
}

function decodeSegment(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

function emptyRoute(view: AppView): Omit<ParsedRoute, NonPathFields> {
  return {
    view,
    automationId: null,
    automationQuick: false,
    automationRunId: null,
    sessionId: null,
    panel: "agents",
    gitView: null,
    gitRefName: null,
    proposalId: null,
    pr: null,
    usageTab: null,
  };
}

/**
 * Sanitised route template for the current pathname — never contains IDs,
 * names, or any other dynamic segment that could leak project / session /
 * repo identifiers into telemetry.
 *
 * Example: `/sessions/abc-123/git` → `/sessions/:sessionId/git`.
 */
export function routePattern(pathname: string): string {
  const route = parseRoute(pathname);
  switch (route.view) {
    case "home":
      return "/";
    case "automations":
      if (route.automationQuick) {
        return route.automationRunId
          ? "/automations/quick/runs/:runId"
          : "/automations/quick";
      }
      if (route.automationId && route.automationRunId) {
        return "/automations/:automationId/runs/:runId";
      }

      return route.automationId ? "/automations/:automationId" : "/automations";
    case "inbox":
      return route.proposalId ? "/inbox/proposals/:proposalId" : "/inbox";
    case "usage":
      return usagePathname(route.usageTab);
    case "design":
      return "/design";
    case "issues": {
      const { issueRef, issueScope } = route;
      const base =
        issueScope === "assigned" ? "/issues" : `/issues/${issueScope}`;

      return issueRef ? `${base}/:issue` : base;
    }
    case "agents":
    case "devices":
    case "notifications":
    case "pull-requests":
    case "runtimes":
      return `/${route.view}`;
    case "session":
      return route.panel === "home"
        ? "/sessions/:sessionId"
        : `/sessions/:sessionId/${route.panel}`;
    case "pull-request-detail":
      return "/pull-requests/:owner/:repo/:number";
  }
}

/**
 * Build a URL for a given route descriptor, including `?host=` when the view
 * reads from a machine other than this one.
 */
export function routeToPath(route: Partial<ParsedRoute>): string {
  return withHostParam(routePathname(route), route.hostId);
}

/** Append the focused host to a path, leaving any existing query intact. */
export function withHostParam(path: string, hostId?: HostId): string {
  if (!hostId || hostId === LOCAL_HOST_ID) {
    return path;
  }

  return `${path}${path.includes("?") ? "&" : "?"}host=${encodeURIComponent(hostId)}`;
}

function routePathname(route: Partial<ParsedRoute>): string {
  if (route.view === "session" && route.sessionId) {
    const panel =
      route.panel && route.panel !== "home" ? `/${route.panel}` : "";
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
  if (route.view === "automations") {
    if (route.automationQuick) {
      return route.automationRunId
        ? `/automations/quick/runs/${encodeURIComponent(route.automationRunId)}`
        : "/automations/quick";
    }
    if (!route.automationId) {
      return "/automations";
    }
    const base = `/automations/${encodeURIComponent(route.automationId)}`;

    return route.automationRunId
      ? `${base}/runs/${encodeURIComponent(route.automationRunId)}`
      : base;
  }
  if (route.view === "pull-request-detail" && route.pr) {
    const { owner, repo, number } = route.pr;

    return `/pull-requests/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/${number}`;
  }
  if (route.view === "inbox") {
    return route.proposalId
      ? `/inbox/proposals/${encodeURIComponent(route.proposalId)}`
      : "/inbox";
  }
  if (route.view === "usage") {
    const path = usagePathname(route.usageTab);
    const range = usageRangeFor(
      route.usageTab ?? null,
      route.usageRange ?? null,
    );

    return range && range !== DEFAULT_USAGE_RANGE
      ? `${path}?range=${range}`
      : path;
  }
  if (route.view === "design") {
    return designPathname(route);
  }
  if (route.view === "issues") {
    const scope = route.issueScope ?? "assigned";
    const base = scope === "assigned" ? "/issues" : `/issues/${scope}`;

    return route.issueRef
      ? `${base}/${encodeURIComponent(route.issueRef)}`
      : base;
  }
  if (
    route.view === "agents" ||
    route.view === "devices" ||
    route.view === "notifications" ||
    route.view === "pull-requests" ||
    route.view === "runtimes"
  ) {
    return `/${route.view}`;
  }

  return "/";
}

/** The default tab keeps the bare `/usage` URL; the rest get a segment. */
function usagePathname(tab: UsageTab | null | undefined): string {
  return !tab || tab === "limits" ? "/usage" : `/usage/${tab}`;
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
    // Search included: `?host=` is part of the route, and non-hook callers
    // read the focused host back out of `getCurrentPath()`.
    const full = `${loc.pathname}${loc.search}`;
    lastPath = full;

    if (historyStack.length === 0) {
      historyStack.push(full);
      historyCursor = 0;
    } else if (navType === "PUSH") {
      historyStack.length = historyCursor + 1;
      historyStack.push(full);
      historyCursor = historyStack.length - 1;
    } else if (navType === "POP") {
      const idx = historyStack.lastIndexOf(full);
      if (idx >= 0) {
        historyCursor = idx;
      }
    } else if (navType === "REPLACE") {
      historyStack[historyCursor] = full;
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
  }, [nav, loc.pathname, loc.search, navType]);
}

/** Navigate to a route descriptor. No-op if already there. */
export function appNavigate(
  route: Partial<ParsedRoute>,
  options?: { replace?: boolean },
): void {
  // The focused host sticks until something names a different one — moving
  // between screens must not silently drop you back onto this Mac.
  const path = routeToPath({
    hostId: getCurrentRoute().hostId,
    ...route,
  });
  if (path === lastPath && !options?.replace) {
    return;
  }
  lastPath = path;
  // When no router is mounted (tests, early startup) the lastPath update
  // above is still honoured by `getCurrentPath` / `getCurrentRoute`, so
  // non-hook consumers still see the navigation.
  navigator?.(path, { replace: options?.replace });
}

/**
 * Navigate to a raw path (deep links from the main process, and the git
 * sub-views that build their own query strings). Carries the focused host
 * along unless the path names one itself.
 *
 * `exact` takes the path as given — window tabs restore a whole saved route,
 * including "no host", and must not inherit the host of the tab being left.
 */
export function navigateToPath(
  path: string,
  options?: { exact?: boolean },
): void {
  const resolved =
    options?.exact || path.includes("host=")
      ? path
      : withHostParam(path, getCurrentRoute().hostId);
  if (!navigator) {
    return;
  }
  lastPath = resolved;
  navigator(resolved);
}

/** Current path as last observed by the registered navigator hook. */
export function getCurrentPath(): string {
  return lastPath ?? "/";
}

/** Non-hook accessor for the current parsed route. */
export function getCurrentRoute(): ParsedRoute {
  return parseRoute(getCurrentPath());
}
