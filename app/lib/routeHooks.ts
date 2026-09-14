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
} from "./router";
import { useMemo } from "react";
import { useLocation } from "react-router-dom";
import { parseRoute } from "./router";

export function useCurrentRoute(): ParsedRoute {
  const { pathname } = useLocation();

  return useMemo(() => parseRoute(pathname), [pathname]);
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

export function useRouteGitView(): GitSubView | null {
  return useCurrentRoute().gitView;
}

export function useRouteGitRefName(): string | null {
  return useCurrentRoute().gitRefName;
}
