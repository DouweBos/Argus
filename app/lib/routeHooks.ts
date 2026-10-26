/**
 * URL-derived hooks for the current route. The URL is the source of truth —
 * these hooks subscribe to `useLocation` and parse the pathname, so every
 * consumer re-renders on navigation without any intermediate Zustand state.
 */

import type {
  AppView,
  GitSubView,
  ParsedRoute,
  PullRequestRef,
  SessionPanel,
  UsageRange,
  UsageTab,
} from "./router";
import type { HostId } from "./transport/hostId";
import { useMemo } from "react";
import { useLocation } from "react-router-dom";
import { DEFAULT_USAGE_RANGE, parseRoute } from "./router";

export function useCurrentRoute(): ParsedRoute {
  const { pathname, search } = useLocation();

  return useMemo(() => parseRoute(`${pathname}${search}`), [pathname, search]);
}

/** Which attached host the current view reads from. */
export function useRouteHostId(): HostId {
  return useCurrentRoute().hostId;
}

export function useRouteView(): AppView {
  return useCurrentRoute().view;
}

export function useRouteSessionId(): string | null {
  return useCurrentRoute().sessionId;
}

export function useRouteSessionPanel(): SessionPanel {
  return useCurrentRoute().panel;
}

export function useRoutePR(): PullRequestRef | null {
  return useCurrentRoute().pr;
}

export function useRouteProposalId(): string | null {
  return useCurrentRoute().proposalId;
}

export function useRouteGitView(): GitSubView | null {
  return useCurrentRoute().gitView;
}

export function useRouteGitRefName(): string | null {
  return useCurrentRoute().gitRefName;
}

/** The usage tab in view; `limits` off the usage screen too, so callers need no fallback. */
export function useRouteUsageTab(): UsageTab {
  return useCurrentRoute().usageTab ?? "limits";
}

/** The cost and tokens tabs' time window. */
export function useRouteUsageRange(): UsageRange {
  return useCurrentRoute().usageRange ?? DEFAULT_USAGE_RANGE;
}
