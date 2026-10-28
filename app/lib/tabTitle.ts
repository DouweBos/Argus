/**
 * The label a window tab shows for a route. Tabs are how a user tells two
 * machines' screens apart, so the label names the screen, not the URL.
 */

import type { AppView, ParsedRoute } from "./router";

const VIEW_TITLES: Record<AppView, string> = {
  agents: "Agents",
  automations: "Automations",
  design: "Design",
  devices: "Devices",
  home: "Home",
  inbox: "Inbox",
  issues: "Issues",
  notifications: "Notifications",
  "pull-request-detail": "Pull request",
  "pull-requests": "Pull requests",
  runtimes: "Runtimes",
  session: "Session",
  usage: "Usage",
};

/** `sessionLabel` is the session's display name or branch, when it is known. */
export function tabTitleForRoute(
  route: ParsedRoute,
  sessionLabel?: string | null,
): string {
  if (route.view === "session") {
    return sessionLabel || VIEW_TITLES.session;
  }
  if (route.view === "pull-request-detail" && route.pr) {
    return `${route.pr.repo}#${route.pr.number}`;
  }

  return VIEW_TITLES[route.view];
}
