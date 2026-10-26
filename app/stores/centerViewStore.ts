/**
 * Center-view helpers. The current view is derived from the URL — these are
 * thin wrappers around `appNavigate` (for writes) and `useRouteView` (for
 * reads). No local Zustand state lives here.
 */

import type { UsageTab } from "../lib/router";
import { useRouteView } from "../lib/routeHooks";
import { appNavigate, getCurrentRoute } from "../lib/router";

export type CenterView =
  | "agents"
  | "automations"
  | "devices"
  | "home"
  | "inbox"
  | "notifications"
  | "pull-request-detail"
  | "pull-requests"
  | "runtimes"
  | "usage";

export const setCenterView = (view: CenterView): void => {
  appNavigate({ view });
};

/** `/usage` — plan limits, and later cost and tokens, each tab its own URL. */
export const openUsage = (tab: UsageTab = "limits"): void => {
  appNavigate({ view: "usage", usageTab: tab });
};

export const useCenterView = (): CenterView => {
  const view = useRouteView();

  return view === "session" ? "home" : view;
};

export const getCenterView = (): CenterView => {
  const view = getCurrentRoute().view;

  return view === "session" ? "home" : view;
};
