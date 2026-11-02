/**
 * The web client's screens and the `docs/routing.md` paths they live at.
 * Shared paths go through `@argus/client-core`'s codec, so a link opens the
 * same screen here as on the Mac; `/projects/:repoRoot` and `/settings` are
 * the phone's own and only exist here and on iOS, and a saved chat at
 * `/sessions/:id/chats/:historyId` only here. A path for a screen the web
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
  /** A session's home: start an agent, its live agents, its saved chats. */
  | { name: "sessionHome"; sessionId: string }
  /** One of a session's saved chats, read back to resume. */
  | { name: "chat"; sessionId: string; historyId: string }
  | { name: "agent"; sessionId: string; agentId: string }
  | { name: "changes"; sessionId: string; mode: DiffMode }
  /** One file's diff from Changes: `/git/:mode/diff?path=`. */
  | { name: "fileDiff"; sessionId: string; mode: DiffMode; path: string }
  /** Quick open's list of the session's files. */
  | { name: "files"; sessionId: string }
  /** `/sessions/:id/code?path=&line=`, as on the Mac and the phone. */
  | { name: "file"; sessionId: string; path: string; line: number | null }
  | { name: "search"; sessionId: string }
  /** The session's terminals, one of them in front when the URL names it. */
  | { name: "terminals"; sessionId: string; terminalId: string | null }
  | { name: "devices" }
  | { name: "device"; platform: RemotePlatform; deviceKey: string }
  | { name: "settings" }
  | { name: "inbox" }
  | { name: "proposal"; proposalId: string }
  | { name: "automations" }
  | { name: "automation"; automationId: string }
  | { name: "automationRun"; automationId: string; runId: string }
  | { name: "quickRun" }
  | { name: "quickRunDetail"; runId: string }
  /** Web and iOS only: on the Mac this is Automations with a sheet. */
  | { name: "describe" };

export type Pane = "detail" | "master";

export const HOME: Screen = { name: "projects" };

/** Which pane a screen occupies once there is room for two. */
export function paneFor(screen: Screen): Pane {
  switch (screen.name) {
    case "projects":
    case "project":
      return "master";
    default:
      return "detail";
  }
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

function queryOf(path: string): URLSearchParams {
  const at = path.indexOf("?");

  return new URLSearchParams(at === -1 ? "" : path.slice(at + 1).split("#")[0]);
}

/**
 * The session's code, search, terminal and per-file diff screens, which the
 * shared codec doesn't spell: the phone's paths for them (`ArgusRoute`'s
 * `/code` keeps its `?path=&line=`).
 */
function sessionToolScreen(parts: string[], path: string): Screen | null {
  if (parts[0] !== "sessions" || !parts[1]) {
    return null;
  }
  const sessionId = parts[1];
  const query = queryOf(path);
  if (parts[2] === "code") {
    if (parts[3] === "search") {
      return { name: "search", sessionId };
    }
    const file = query.get("path");
    if (parts.length === 3 && file) {
      const line = Number(query.get("line"));

      return {
        name: "file",
        sessionId,
        path: file,
        line: Number.isInteger(line) && line > 0 ? line : null,
      };
    }

    // `/code` with no file, and `/code/quick-open`: the file list.
    return { name: "files", sessionId };
  }
  if (parts[2] === "terminals") {
    return { name: "terminals", sessionId, terminalId: parts[3] ?? null };
  }
  const file = query.get("path");
  if (
    parts[2] === "git" &&
    (parts[3] === "branch" || parts[3] === "working") &&
    parts[4] === "diff" &&
    file
  ) {
    return { name: "fileDiff", sessionId, mode: parts[3], path: file };
  }

  return null;
}

/** A path (with any query) inside the app's base, read as a screen. */
export function screenFromPath(path: string): Screen {
  const pathname = path.split(/[?#]/, 1)[0];
  const parts = pathname.split("/").filter(Boolean).map(decode);
  const tool = sessionToolScreen(parts, path);
  if (tool) {
    return tool;
  }
  if (parts[0] === "projects" && parts.length === 2) {
    return { name: "project", projectKey: parts[1] };
  }
  if (parts[0] === "sessions" && parts[2] === "chats" && parts.length === 4) {
    return { name: "chat", sessionId: parts[1], historyId: parts[3] };
  }
  if (parts[0] === "settings" && parts.length === 1) {
    return { name: "settings" };
  }
  if (parts[0] === "automations" && parts[1] === "describe") {
    return { name: "describe" };
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
    case "inbox":
      return route.proposalId
        ? { name: "proposal", proposalId: route.proposalId }
        : { name: "inbox" };
    case "automations":
      if (route.automationQuick) {
        return route.automationRunId
          ? { name: "quickRunDetail", runId: route.automationRunId }
          : { name: "quickRun" };
      }
      if (route.automationId && route.automationRunId) {
        return {
          name: "automationRun",
          automationId: route.automationId,
          runId: route.automationRunId,
        };
      }

      return route.automationId
        ? { name: "automation", automationId: route.automationId }
        : { name: "automations" };
    case "session": {
      const sessionId = decode(route.sessionId ?? "");
      if (route.panel === "git") {
        return {
          name: "changes",
          sessionId,
          mode: route.gitView === "working" ? "working" : "branch",
        };
      }

      if (route.panel === "home") {
        return { name: "sessionHome", sessionId };
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

function sessionBase(sessionId: string): string {
  return `/sessions/${encodeURIComponent(sessionId)}`;
}

/** The path a screen lives at, with only the query the screen itself needs. */
export function pathForScreen(screen: Screen): string {
  switch (screen.name) {
    case "files":
      return `${sessionBase(screen.sessionId)}/code/quick-open`;
    case "search":
      return `${sessionBase(screen.sessionId)}/code/search`;
    case "file": {
      const query = new URLSearchParams({ path: screen.path });
      if (screen.line) {
        query.set("line", String(screen.line));
      }

      return `${sessionBase(screen.sessionId)}/code?${query.toString()}`;
    }
    case "terminals":
      return screen.terminalId
        ? `${sessionBase(screen.sessionId)}/terminals/${encodeURIComponent(screen.terminalId)}`
        : `${sessionBase(screen.sessionId)}/terminals`;
    case "fileDiff":
      return `${sessionBase(screen.sessionId)}/git/${screen.mode}/diff?${new URLSearchParams({ path: screen.path }).toString()}`;
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
    case "sessionHome":
      return routeToPath({
        view: "session",
        sessionId: encodeURIComponent(screen.sessionId),
        panel: "home",
      });
    case "chat":
      return `/sessions/${encodeURIComponent(screen.sessionId)}/chats/${encodeURIComponent(screen.historyId)}`;
    case "changes":
      return routeToPath({
        view: "session",
        sessionId: encodeURIComponent(screen.sessionId),
        panel: "git",
        gitView: screen.mode,
      });
    case "inbox":
      return "/inbox";
    case "proposal":
      return `/inbox/proposals/${encodeURIComponent(screen.proposalId)}`;
    case "automations":
      return "/automations";
    case "automation":
      return `/automations/${encodeURIComponent(screen.automationId)}`;
    case "automationRun":
      return `/automations/${encodeURIComponent(screen.automationId)}/runs/${encodeURIComponent(screen.runId)}`;
    case "quickRun":
      return "/automations/quick";
    case "quickRunDetail":
      return `/automations/quick/runs/${encodeURIComponent(screen.runId)}`;
    case "describe":
      return "/automations/describe";
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
    case "sessionHome":
      return "/sessions/:sessionId";
    case "chat":
      return "/sessions/:sessionId/chats/:historyId";
    case "changes":
      return `/sessions/:sessionId/git/${screen.mode}`;
    case "fileDiff":
      return `/sessions/:sessionId/git/${screen.mode}/diff`;
    case "files":
      return "/sessions/:sessionId/code/quick-open";
    case "file":
      return "/sessions/:sessionId/code";
    case "search":
      return "/sessions/:sessionId/code/search";
    case "terminals":
      return screen.terminalId
        ? "/terminals/:terminalId"
        : "/sessions/:sessionId/terminals";
    case "inbox":
      return "/inbox";
    case "proposal":
      return "/inbox/proposals/:proposalId";
    case "automations":
      return "/automations";
    case "automation":
      return "/automations/:automationId";
    case "automationRun":
      return "/automations/:automationId/runs/:runId";
    case "quickRun":
      return "/automations/quick";
    case "quickRunDetail":
      return "/automations/quick/runs/:runId";
    case "describe":
      return "/automations/describe";
  }
}

/** The session a screen belongs to, if any. */
export function sessionOfScreen(screen: Screen): string | null {
  return "sessionId" in screen ? screen.sessionId : null;
}

/** Same screen, so one navigation per change and no duplicate history entries. */
export function sameScreen(a: Screen, b: Screen): boolean {
  return pathForScreen(a) === pathForScreen(b);
}
