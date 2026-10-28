/**
 * Which address to dial a host on. Pure: the dialer feeds it the host's routes
 * and what happened on each, and it answers "dial this next" or "try that
 * better one now". No sockets, no timers, no React.
 */

import type { RemoteEndpoint } from "../types";

export type RouteKind = RemoteEndpoint["kind"];

export interface RouteCandidate {
  kind: RouteKind;
  priority: number;
  url: string;
}

/** What one address has done lately, keyed by URL. */
export interface RouteHealth {
  failedAt: number | null;
  /** Consecutive failed attempts or probes since it last worked. */
  failures: number;
  lastGoodAt: number | null;
}

export type RouteHealthMap = ReadonlyMap<string, RouteHealth>;

/** Give up on an attempt this long after dialing; a tunnel gets longer. */
const ATTEMPT_TIMEOUT_MS: Record<RouteKind, number> = {
  lan: 3_000,
  tailscale: 5_000,
  cloudflare: 10_000,
};

/** First upgrade retry after a failed probe, doubling up to the cap. */
export const UPGRADE_COOLDOWN_MS = 30_000;
export const UPGRADE_COOLDOWN_MAX_MS = 10 * 60_000;
/** How often a host on a worse route checks whether a better one is back. */
export const UPGRADE_INTERVAL_MS = 60_000;
/** Pause before cycling through every route again once they all failed. */
export const RETRY_BACKOFF_MS = [1_000, 2_000, 5_000, 10_000, 30_000];

const UNKNOWN_PRIORITY = 1_000;

export function attemptTimeoutMs(kind: RouteKind): number {
  return ATTEMPT_TIMEOUT_MS[kind];
}

/** Rough kind for an address we only know by URL (a QR pairing, old store). */
export function inferKind(url: string): RouteKind {
  if (url.startsWith("wss:")) {
    return "cloudflare";
  }

  return /^ws:\/\/100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./.test(url)
    ? "tailscale"
    : "lan";
}

/**
 * Every distinct address for a host. Its stored `url` stays a candidate even
 * when the endpoint list doesn't name it, so an old pairing never loses its
 * only way in.
 */
export function routeCandidates(
  url: string,
  endpoints: readonly RemoteEndpoint[] | undefined,
): RouteCandidate[] {
  const seen = new Set<string>();
  const out: RouteCandidate[] = [];
  for (const e of endpoints ?? []) {
    if (e.url && !seen.has(e.url)) {
      seen.add(e.url);
      out.push({ kind: e.kind, priority: e.priority, url: e.url });
    }
  }
  if (url && !seen.has(url)) {
    out.push({ kind: inferKind(url), priority: UNKNOWN_PRIORITY, url });
  }

  return out;
}

/** Time to try every route once, so an attach doesn't give up mid-fallback. */
export function attachBudgetMs(
  url: string,
  endpoints: readonly RemoteEndpoint[] | undefined,
): number {
  return routeCandidates(url, endpoints).reduce(
    (sum, c) => sum + attemptTimeoutMs(c.kind),
    1_000,
  );
}

/** Best first: lowest priority, then the one that worked most recently. */
export function rankRoutes(
  candidates: readonly RouteCandidate[],
  health: RouteHealthMap,
): RouteCandidate[] {
  const good = (c: RouteCandidate) => health.get(c.url)?.lastGoodAt ?? 0;

  return candidates
    .map((c, i) => ({ c, i }))
    .sort(
      (a, b) =>
        a.c.priority - b.c.priority || good(b.c) - good(a.c) || a.i - b.i,
    )
    .map(({ c }) => c);
}

/**
 * The route to dial after `failedUrl` didn't answer, or null when every route
 * has had its turn this cycle and it's time to back off.
 */
export function nextRoute(
  ranked: readonly RouteCandidate[],
  failedUrl: string,
  triedThisCycle: ReadonlySet<string>,
): RouteCandidate | null {
  const start = ranked.findIndex((c) => c.url === failedUrl) + 1;
  for (let i = 0; i < ranked.length; i++) {
    const candidate = ranked[(start + i) % ranked.length];
    if (!triedThisCycle.has(candidate.url)) {
      return candidate;
    }
  }

  return null;
}

export function upgradeCooldownMs(failures: number): number {
  if (failures <= 0) {
    return 0;
  }

  return Math.min(
    UPGRADE_COOLDOWN_MS * 2 ** (failures - 1),
    UPGRADE_COOLDOWN_MAX_MS,
  );
}

/**
 * A better-ranked route worth probing while connected over `currentUrl`, or
 * null. Routes that failed recently sit out their cooldown, so a LAN address
 * from another network isn't hammered once a minute forever.
 */
export function upgradeCandidate(
  ranked: readonly RouteCandidate[],
  currentUrl: string,
  health: RouteHealthMap,
  now: number,
): RouteCandidate | null {
  const current = ranked.find((c) => c.url === currentUrl);
  const better = current
    ? ranked.filter((c) => c.priority < current.priority)
    : ranked;
  for (const candidate of better) {
    const h = health.get(candidate.url);
    if (!h?.failedAt || now - h.failedAt >= upgradeCooldownMs(h.failures)) {
      return candidate;
    }
  }

  return null;
}

/** The health map after an attempt or probe on `url` ended. */
export function recordRoute(
  health: RouteHealthMap,
  url: string,
  ok: boolean,
  now: number,
): Map<string, RouteHealth> {
  const next = new Map(health);
  const prev = health.get(url) ?? {
    failures: 0,
    failedAt: null,
    lastGoodAt: null,
  };
  next.set(
    url,
    ok
      ? { failures: 0, failedAt: null, lastGoodAt: now }
      : { ...prev, failures: prev.failures + 1, failedAt: now },
  );

  return next;
}

/** Same addresses in the same order — nothing for the dialer to redo. */
export function sameRoutes(
  a: readonly RouteCandidate[],
  b: readonly RouteCandidate[],
): boolean {
  return (
    a.length === b.length &&
    a.every((c, i) => c.url === b[i].url && c.priority === b[i].priority)
  );
}
