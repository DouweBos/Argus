/**
 * How a screen reached the browser from outside the app: a shared link, or a
 * notification. Patterns only; the path itself never leaves.
 */

import { appPath } from "../routing/router";
import { screenFromPath, screenPattern } from "../routing/screens";
import { capture } from "./telemetry";

let reported = false;

/** The client has no screen for this path and opened its parent instead. */
export function isFallback(path: string): boolean {
  const pathname = path.split(/[?#]/, 1)[0].replace(/\/+$/, "") || "/";
  const screen = screenFromPath(path);
  if (screen.name === "projects") {
    return pathname !== "/";
  }

  return screen.name === "devices" && pathname !== "/devices";
}

/** Once per page load: what the launch URL opened, when it was more than Home. */
export function reportLaunchLink(): void {
  if (reported) {
    return;
  }
  reported = true;
  const path = appPath();
  const params = new URLSearchParams(window.location.search);
  if (params.has("agent")) {
    capture("web_link_opened", {
      screen: "/sessions/:sessionId/agents",
      via: "notification",
      fallback: false,
    });

    return;
  }
  const pathname = path.split("?", 1)[0];
  if (pathname === "/" || pathname === "") {
    return;
  }
  capture("web_link_opened", {
    screen: screenPattern(screenFromPath(path)),
    via: "link",
    fallback: isFallback(path),
  });
}

/** A notification in a running tab was clicked through to its agent. */
export function reportNotificationOpen(): void {
  capture("web_link_opened", {
    screen: "/sessions/:sessionId/agents",
    via: "notification",
    fallback: false,
  });
}
