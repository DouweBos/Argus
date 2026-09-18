/**
 * Which screen Argus opens on. A setting rather than a constant because the
 * answer changes with how much initiative Argus has: the project picker while
 * you start everything yourself, the inbox once automations are finding work.
 */

import { getAppSettings } from "./ipc";
import { appNavigate, getCurrentPath } from "./router";

export type LaunchRoute = "home" | "inbox";

/**
 * Navigate to the configured launch screen. A no-op unless the window is
 * still on `/` — a restored tab or a deep link already named a destination,
 * and a preference must not overrule either.
 */
export async function applyLaunchRoute(): Promise<void> {
  let route: LaunchRoute = "home";
  try {
    route = (await getAppSettings()).launch_route ?? "home";
  } catch {
    return;
  }
  if (route === "home" || getCurrentPath() !== "/") {
    return;
  }
  appNavigate({ view: "inbox" }, { replace: true });
}
