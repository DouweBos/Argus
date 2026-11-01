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

import type { ParsedRoute } from "@argus/client-core";
import { useEffect } from "react";
import { useLocation, useNavigate, useNavigationType } from "react-router-dom";
import type { NavigateFunction } from "react-router-dom";
import * as codec from "@argus/client-core";
import { capturePageview } from "./telemetry";

// The codec is pure and shared with the web client; navigation stays here.
export type {
  AppView,
  GitSubView,
  IssueScope,
  ParsedRoute,
  PullRequestRef,
  SessionPanel,
  UsageRange,
  UsageTab,
} from "@argus/client-core";
export const DEFAULT_USAGE_RANGE = codec.DEFAULT_USAGE_RANGE;
export const parseRoute = codec.parseRoute;
export const routePattern = codec.routePattern;
export const routeToPath = codec.routeToPath;
export const withHostParam = codec.withHostParam;

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
