/**
 * `useSessionSync(sessionId, baseBranch)` — ahead/behind counts for a
 * session branch vs its effective remote tracking ref.
 *
 * Two-tier resolution:
 *   1. If the session branch has its own upstream (e.g. after push), use the
 *      `git status --porcelain=v2` numbers (already populated on the shared
 *      observation store).
 *   2. Otherwise fall back to comparing `HEAD` against `origin/<baseBranch>`
 *      so unpublished session branches still surface how far they've diverged
 *      from the trunk on origin.
 */

import { useEffect, useState } from "react";
import { gitCompareBranches } from "../lib/ipc";
import { useGitObservation } from "./useGitObservation";

export interface SessionSync {
  ahead: number;
  behind: number;
  /** True when ahead/behind reflects a real comparison (vs. unknown remote). */
  resolved: boolean;
  /** Ref that ahead/behind is computed against (e.g. `origin/main`). */
  upstreamRef: string | null;
}

const EMPTY: SessionSync = {
  ahead: 0,
  behind: 0,
  resolved: false,
  upstreamRef: null,
};

export function useSessionSync(
  sessionId: string,
  baseBranch?: string | null,
): SessionSync {
  const { status } = useGitObservation(sessionId);
  const upstream = status?.upstream ?? null;
  const branch = status?.branch ?? "";
  const ahead = status?.ahead ?? 0;
  const behind = status?.behind ?? 0;

  const fallbackRef =
    baseBranch && baseBranch !== branch ? `origin/${baseBranch}` : null;
  const useFallback = Boolean(sessionId) && !upstream && fallbackRef !== null;

  const [fallback, setFallback] = useState<SessionSync>(EMPTY);

  // Marker that flips when the local tip moves so the fallback re-runs after
  // commits/resets even if the upstream string itself didn't change.
  const tipMarker = `${branch}|${ahead}|${behind}`;

  useEffect(() => {
    if (!useFallback || !fallbackRef) {
      return;
    }
    let cancelled = false;
    gitCompareBranches(sessionId, "HEAD", fallbackRef)
      .then((res) => {
        if (cancelled) {
          return;
        }
        setFallback({
          ahead: res.leftOnly.length,
          behind: res.rightOnly.length,
          resolved:
            res.mergeBase != null ||
            res.leftOnly.length > 0 ||
            res.rightOnly.length > 0,
          upstreamRef: fallbackRef,
        });
      })
      .catch(() => {
        if (!cancelled) {
          setFallback(EMPTY);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [sessionId, useFallback, fallbackRef, tipMarker]);

  if (upstream) {
    return { ahead, behind, resolved: true, upstreamRef: upstream };
  }

  return fallback;
}
