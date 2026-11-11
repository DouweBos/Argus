/**
 * The URL is the single source of truth for which screen is showing. Reads
 * go through `currentLocation()` / `useLocation()`; writes through
 * `appNavigate(screen)`, one per user action (CLAUDE.md routing rule 3).
 *
 * Real paths on the History API, under the build's base (`/` for the network
 * bundle, `/argus/app/` for the hosted one). `?host=<hostId>` names the
 * computer in the hosted app and sticks across navigations; the network
 * bundle is always its own host and never writes it. The fragment is left
 * alone: huddle links (`#huddle=`) and pairing codes (`#pair=`) live there, so
 * secrets never reach a server.
 */

import { HOME, pathForScreen, screenFromPath, type Screen } from "./screens";

export interface AppLocation {
  screen: Screen;
  /** `?host=`, the computer the hosted app reads from. */
  hostId: string | null;
}

/** History entries this tab pushed, so Back knows whether it would leave the app. */
interface EntryState {
  argusDepth: number;
}

const listeners = new Set<() => void>();

function base(): string {
  const raw = import.meta.env.BASE_URL || "/";

  return raw.endsWith("/") ? raw : `${raw}/`;
}

/** The path inside the base, with its query: `/sessions/a/agents/b?host=h`. */
export function appPath(): string {
  const prefix = base();
  const { pathname, search } = window.location;
  const inside = pathname.startsWith(prefix)
    ? pathname.slice(prefix.length - 1)
    : pathname;

  return `${inside || "/"}${search}`;
}

export function currentLocation(): AppLocation {
  const host = new URLSearchParams(window.location.search).get("host");

  return {
    screen: screenFromPath(appPath()),
    hostId: host && host.length > 0 ? host : null,
  };
}

function depth(): number {
  return (window.history.state as EntryState | null)?.argusDepth ?? 0;
}

function hrefFor(screen: Screen, hostId: string | null): string {
  const path = pathForScreen(screen);
  // A screen may carry its own query (`/code?path=`); `host` joins it.
  const joiner = path.includes("?") ? "&" : "?";
  const query = hostId ? `${joiner}host=${encodeURIComponent(hostId)}` : "";

  return `${base()}${path.slice(1)}${query}${window.location.hash}`;
}

/** The href for a screen on the current computer, for a real link. */
export function screenHref(screen: Screen): string {
  return hrefFor(screen, currentLocation().hostId);
}

function notify(): void {
  for (const listener of listeners) {
    listener();
  }
}

export interface NavigateOptions {
  replace?: boolean;
  /** Another computer, or `null` for none. Defaults to the current one. */
  hostId?: string | null;
}

/** Go to a screen. No-op when already there. */
export function appNavigate(screen: Screen, options: NavigateOptions = {}): void {
  const hostId =
    options.hostId === undefined ? currentLocation().hostId : options.hostId;
  const href = hrefFor(screen, hostId);
  const here = `${window.location.pathname}${window.location.search}${window.location.hash}`;
  if (href === here) {
    return;
  }
  if (options.replace) {
    window.history.replaceState({ argusDepth: depth() }, "", href);
  } else {
    window.history.pushState({ argusDepth: depth() + 1 }, "", href);
  }
  notify();
}

/**
 * Back within the app, or to `parent` when this tab opened straight onto the
 * current screen (a deep link) and Back would leave Argus.
 */
export function navigateBack(parent: Screen = HOME): void {
  if (depth() > 0) {
    window.history.back();
  } else {
    appNavigate(parent, { replace: true });
  }
}

/** Drop a query item a launch URL carried (`?agent=`), keeping the rest. */
export function stripQuery(...names: string[]): void {
  const params = new URLSearchParams(window.location.search);
  for (const name of names) {
    params.delete(name);
  }
  const query = params.toString();
  window.history.replaceState(
    window.history.state,
    "",
    `${window.location.pathname}${query ? `?${query}` : ""}${window.location.hash}`,
  );
  notify();
}

/** Called on every change of location, including back/forward. */
export function subscribeLocation(listener: () => void): () => void {
  listeners.add(listener);
  if (listeners.size === 1) {
    window.addEventListener("popstate", notify);
  }

  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) {
      window.removeEventListener("popstate", notify);
    }
  };
}

/** The current location as a stable string, for `useSyncExternalStore`. */
export function locationKey(): string {
  return `${window.location.pathname}${window.location.search}`;
}
