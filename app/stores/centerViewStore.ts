/**
 * Center-view helpers. The current view is derived from the URL — these are
 * thin wrappers around `appNavigate` (for writes) and `useRouteView` /
 * `useRouteOrganizationId` (for reads). No local Zustand state lives here.
 */

import { useRouteOrganizationId, useRouteView } from "../lib/routeHooks";
import { appNavigate, getCurrentRoute } from "../lib/router";

export type CenterView =
  | "agents"
  | "devices"
  | "home"
  | "notifications"
  | "organizations"
  | "pull-request-detail"
  | "pull-requests"
  | "runtimes";

export const setCenterView = (view: CenterView): void => {
  appNavigate({ view });
};

export const openOrganization = (organizationId: string): void => {
  appNavigate({ view: "organizations", organizationId });
};

export const clearSelectedOrganization = (): void => {
  // No-op — the org id only lives in the URL. Navigate explicitly away from
  // a specific org if you want to clear it.
};

export const useCenterView = (): CenterView => {
  const view = useRouteView();

  return view === "session" ? "home" : view;
};

export const useSelectedOrganizationId = (): string | null =>
  useRouteOrganizationId();

export const getCenterView = (): CenterView => {
  const view = getCurrentRoute().view;

  return view === "session" ? "home" : view;
};
