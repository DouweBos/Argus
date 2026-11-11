/**
 * The route codec behind `docs/routing.md`: parse a path into a
 * {@link ParsedRoute}, build one back, and reduce it to a pattern telemetry
 * may see. Pure, so the desktop renderer and the web client share it; the
 * Swift twin is `ArgusRoute+Path` in ArgusCore.
 *
 * Every URL may carry `?host=<hostId>` naming the machine the view reads
 * from; {@link LOCAL_HOST_ID} when absent.
 */

import type { UsageRange } from "@argus/remote-protocol";
import {
  type DesignRouteFields,
  designPathname,
  designRouteFields,
} from "./design";

export type HostId = string;

/**
 * Reserved id for the machine the client runs on. Never issued as a device id
 * by a host (those are uuids), so it can't collide with a paired host's id.
 */
export const LOCAL_HOST_ID = "local";

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

/** A model of the usage summary: `/usage/:tab/models/:runner/:model`. */
export interface UsageModelRef {
  runner: string;
  model: string;
}

export interface PullRequestRef {
  number: number;
  owner: string;
  repo: string;
}

export interface ParsedRoute extends DesignRouteFields {
  /**
   * The agent tab `/sessions/:sessionId/agents/:agentId` is focused on. Only
   * meaningful when view === "session" and panel === "agents".
   */
  agentId: string | null;
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
  /** `?q=` of `/issues/search`: the term searched across the whole workspace. */
  issueQuery: string | null;
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
  /** The model open on the cost or tokens tab, if any. */
  usageModel: UsageModelRef | null;
  /** `/usage/prices`: the model price editor. */
  usagePrices: boolean;
  /** `?range=` of the cost and tokens tabs; null everywhere else. */
  usageRange: UsageRange | null;
  /** Which usage tab is open. Only meaningful when view === "usage". */
  usageTab: UsageTab | null;
  view: AppView;
}

const VALID_PANELS: SessionPanel[] = ["agents", "git", "home"];

/** `search` lists `?q=` results from the whole workspace instead of your issues. */
export type IssueScope = "assigned" | "created" | "search" | "subscribed";
const ISSUE_SCOPES: IssueScope[] = [
  "assigned",
  "created",
  "search",
  "subscribed",
];

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

function issueQueryFor(pathname: string, raw: string | null): string | null {
  const term = raw?.trim();

  const [first, second] = pathname.split("/").filter(Boolean);

  return first === "issues" && second === "search" && term ? term : null;
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
    issueQuery: issueQueryFor(pathname, params.get("q")),
    ...designRouteFields(pathname, params),
    hostId: hostId && hostId.length > 0 ? hostId : LOCAL_HOST_ID,
    usageRange: usageRangeFor(route.usageTab, params.get("range")),
  };
}

/** Fields `parsePathname` leaves to the query and sub-route helpers. */
type NonPathFields =
  | keyof DesignRouteFields
  | "hostId"
  | "issueQuery"
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
    if (segments[1] === "prices") {
      return { ...emptyRoute("usage"), usagePrices: true };
    }
    const candidate = segments[1] as UsageTab | undefined;
    const usageTab =
      candidate && VALID_USAGE_TABS.includes(candidate) ? candidate : "limits";
    const usageModel =
      usageTab !== "limits" &&
      segments[2] === "models" &&
      segments[3] &&
      segments[4]
        ? {
            runner: decodeSegment(segments[3]),
            model: decodeSegment(segments[4]),
          }
        : null;

    return { ...emptyRoute("usage"), usageTab, usageModel };
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
      agentId:
        validPanel === "agents" && segments[3]
          ? decodeSegment(segments[3])
          : null,
      automationId: null,
      automationQuick: false,
      automationRunId: null,
      sessionId: segments[1],
      panel: validPanel,
      gitView,
      gitRefName,
      proposalId: null,
      pr: null,
      usageModel: null,
      usagePrices: false,
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
        agentId: null,
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
        usageModel: null,
        usagePrices: false,
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
    agentId: null,
    automationId: null,
    automationQuick: false,
    automationRunId: null,
    sessionId: null,
    panel: "agents",
    gitView: null,
    gitRefName: null,
    proposalId: null,
    pr: null,
    usageModel: null,
    usagePrices: false,
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
      if (route.usagePrices) {
        return "/usage/prices";
      }

      return route.usageModel
        ? `${usagePathname(route.usageTab)}/models/:runner/:model`
        : usagePathname(route.usageTab);
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

    const agent =
      route.panel === "agents" && route.agentId
        ? `/${encodeURIComponent(route.agentId)}`
        : "";

    return `/sessions/${route.sessionId}${panel}${agent}${gitView}${gitRef}`;
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
    if (route.usagePrices) {
      return "/usage/prices";
    }
    const model =
      route.usageModel &&
      (route.usageTab === "cost" || route.usageTab === "tokens")
        ? `/models/${encodeURIComponent(route.usageModel.runner)}/${encodeURIComponent(route.usageModel.model)}`
        : "";
    const path = `${usagePathname(route.usageTab)}${model}`;
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

    const path = route.issueRef
      ? `${base}/${encodeURIComponent(route.issueRef)}`
      : base;
    const term = route.issueQuery?.trim();

    return term ? `${path}?q=${encodeURIComponent(term)}` : path;
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
