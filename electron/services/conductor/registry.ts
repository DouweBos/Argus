/**
 * npm registry lookup for available conductor versions.
 *
 * Powers the Settings → Tools version dropdown. Only versions at or above the
 * one bundled with this build are offered — older conductors predate APIs the
 * app relies on. Results are cached briefly so opening Settings repeatedly
 * doesn't hammer the registry.
 */

import { createLogger } from "../../../app/lib/logger";
import { CONDUCTOR_PACKAGE } from "./install";

const logger = createLogger("conductor:registry");

const REGISTRY_URL = `https://registry.npmjs.org/${CONDUCTOR_PACKAGE.replace("/", "%2F")}`;
const FETCH_TIMEOUT_MS = 10_000;
const CACHE_TTL_MS = 5 * 60_000;

/** Stable releases only — prereleases aren't offered in the picker. */
const STABLE_RE = /^\d+\.\d+\.\d+$/;

let cache: { at: number; versions: string[] } | null = null;

/** Numeric semver compare; returns >0 when `a` is newer than `b`. */
export function compareVersions(a: string, b: string): number {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (diff !== 0) {
      return diff;
    }
  }

  return 0;
}

/**
 * Published stable versions >= `minVersion`, newest first. Throws a string
 * error on network/registry failure so the UI can surface it.
 */
export async function listConductorVersions(
  minVersion: string | null,
  now: number = Date.now(),
): Promise<string[]> {
  let versions = cache && now - cache.at < CACHE_TTL_MS ? cache.versions : null;

  if (!versions) {
    versions = await fetchVersions();
    cache = { at: now, versions };
  }

  return versions
    .filter((v) => !minVersion || compareVersions(v, minVersion) >= 0)
    .sort((a, b) => compareVersions(b, a));
}

async function fetchVersions(): Promise<string[]> {
  let res: Response;
  try {
    res = await fetch(REGISTRY_URL, {
      headers: { accept: "application/vnd.npm.install-v1+json" },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    logger.warn("Failed to reach npm registry:", message);
    throw `Could not reach the npm registry: ${message}`;
  }
  if (!res.ok) {
    throw `npm registry returned ${res.status}`;
  }

  const body = (await res.json()) as { versions?: Record<string, unknown> };

  return Object.keys(body.versions ?? {}).filter((v) => STABLE_RE.test(v));
}
