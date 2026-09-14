/**
 * Center-view helpers. The current view is derived from the URL — these are
 * thin wrappers around `appNavigate` (for writes) and `useRouteView` (for
 * reads). No local Zustand state lives here.
 */

import { useRouteView } from "../lib/routeHooks";
import { appNavigate, getCurrentRoute } from "../lib/router";

export type CenterView =
  | "agents"
  | "devices"
  | "home"
  | "notifications"
  | "pull-request-detail"
  | "pull-requests"
  | "runtimes";

export const setCenterView = (view: CenterView): void => {
  appNavigate({ view });
};

export const useCenterView = (): CenterView => {
  const view = useRouteView();

  return view === "session" ? "home" : view;
};

export const getCenterView = (): CenterView => {
  const view = getCurrentRoute().view;

  return view === "session" ? "home" : view;
};
