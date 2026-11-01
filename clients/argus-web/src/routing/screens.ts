/**
 * The web client's screens and the `docs/routing.md` paths they live at.
 * Shared paths go through `@argus/client-core`'s codec, so a link opens the
 * same screen here as on the Mac; `/projects/:repoRoot` and `/settings` are
 * the phone's own and only exist here and on iOS. A path for a screen the web
 * client doesn't have yet opens its nearest parent, as on iOS.
 *
 * A project is named by a hash of its repo root, never the path itself: the
 * hosted app's paths reach its server on every reload.
 */

import { parseRoute, routeToPath } from "@argus/client-core";
import type { RemotePlatform } from "../lib/protocol";

export type DiffMode = "branch" | "working";

export type Screen =
  | { name: "projects" }
  /** `projectKey(repo_root)`; the projects list says which project it is. */
  | { name: "project"; projectKey: string }
  /** A session with no agent picked: shows its newest agent once known. */
  | { name: "session"; sessionId: string }
  | { name: "agent"; sessionId: string; agentId: string }
  | { name: "changes"; sessionId: string; mode: DiffMode }
  | { name: "devices" }
  | { name: "device"; platform: RemotePlatform; deviceKey: string }
  | { name: "settings" };

export type Pane = "detail" | "master";

export const HOME: Screen = { name: "projects" };

/** Which pane a screen occupies once there is room for two. */
export function paneFor(screen: Screen): Pane {
  return screen.name === "projects" || screen.name === "project"
    ? "master"
    : "detail";
}

/** FNV-1a over UTF-16 units, from a given basis. */
function fnv1a(text: string, basis: number): string {
  let hash = basis;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }

  return (hash >>> 0).toString(16).padStart(8, "0");
}

/** A stable, opaque name for a repo root: 64 bits, as two FNV-1a passes. */
export function projectKey(repoRoot: string): string {
  return fnv1a(repoRoot, 0x811c9dc5) + fnv1a(repoRoot, 0x050c5d1f);
}

export function projectScreen(repoRoot: string): Screen {
  return { name: "project", projectKey: projectKey(repoRoot) };
}

function decode(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

/** A path (with any query) inside the app's base, read as a screen. */
export function screenFromPath(path: string): Screen {
  const pathname = path.split(/[?#]/, 1)[0];
  const parts = pathname.split("/").filter(Boolean).map(decode);
  if (parts[0] === "projects" && parts.length === 2) {
    return { name: "project", projectKey: parts[1] };
  }
  if (parts[0] === "settings" && parts.length === 1) {
    return { name: "settings" };
  }
  if (parts[0] === "devices" && parts.length === 3) {
    const platform = parts[1];
    if (platform === "ios" || platform === "android") {
      return { name: "device", platform, deviceKey: parts[2] };
    }

    // `web` devices (browsers) have no screen here yet.
    return { name: "devices" };
  }
  const route = parseRoute(path);
  switch (route.view) {
    case "devices":
      return { name: "devices" };
    case "session": {
      const sessionId = decode(route.sessionId ?? "");
      if (route.panel === "git") {
        return {
          name: "changes",
          sessionId,
          mode: route.gitView === "working" ? "working" : "branch",
        };
      }

      return route.agentId
        ? { name: "agent", sessionId, agentId: route.agentId }
        : { name: "session", sessionId };
    }
    default:
      // Home, and every screen the web client doesn't have yet.
      return HOME;
  }
}

/** The path a screen lives at, without the query. */
export function pathForScreen(screen: Screen): string {
  switch (screen.name) {
    case "projects":
      return "/";
    case "project":
      return `/projects/${encodeURIComponent(screen.projectKey)}`;
    case "settings":
      return "/settings";
    case "devices":
      return "/devices";
    case "device":
      return `/devices/${screen.platform}/${encodeURIComponent(screen.deviceKey)}`;
    case "session":
      return routeToPath({
        view: "session",
        sessionId: encodeURIComponent(screen.sessionId),
        panel: "agents",
      });
    case "agent":
      return routeToPath({
        view: "session",
        sessionId: encodeURIComponent(screen.sessionId),
        panel: "agents",
        agentId: screen.agentId,
      });
    case "changes":
      return routeToPath({
        view: "session",
        sessionId: encodeURIComponent(screen.sessionId),
        panel: "git",
        gitView: screen.mode,
      });
  }
}

/**
 * The route pattern, never an id: what telemetry may see. The iOS app's
 * patterns for the same screens, so one screen reads the same from either.
 */
export function screenPattern(screen: Screen): string {
  switch (screen.name) {
    case "projects":
      return "/";
    case "project":
      return "/projects/:projectKey";
    case "settings":
      return "/settings";
    case "devices":
      return "/devices";
    case "device":
      return "/devices/:platform/:deviceKey";
    case "session":
    case "agent":
      return "/sessions/:sessionId/agents";
    case "changes":
      return `/sessions/:sessionId/git/${screen.mode}`;
  }
}

/** Same screen, so one navigation per change and no duplicate history entries. */
export function sameScreen(a: Screen, b: Screen): boolean {
  return pathForScreen(a) === pathForScreen(b);
}
