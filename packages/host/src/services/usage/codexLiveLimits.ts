/**
 * The latest rate-limit snapshot a running Codex agent pushed, fresher than
 * the last probe. A leaf module so the Codex runner can feed it without
 * importing the usage service.
 */

let latest: { at: number; raw: unknown } | null = null;

export function noteCodexRateLimits(raw: unknown, at = Date.now()): void {
  latest = { at, raw };
}

export function latestCodexRateLimits(): { at: number; raw: unknown } | null {
  return latest;
}
