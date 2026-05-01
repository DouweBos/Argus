/**
 * `useGitObservation(sessionId, options?)` — single shared subscription to
 * a session's git observation slice (status + diffStats + error). N consumers
 * for the same id share one timer / one set of IPC listeners — see
 * `gitObservationStore.ts` for the lifecycle.
 */

import { useEffect } from "react";
import {
  acquire,
  type GitObservation,
  refreshGitObservation,
  release,
  useGitObservationValue,
} from "../stores/gitObservationStore";

interface UseGitObservationOptions {
  /** When false, the hook is a no-op — no acquire, no subscription. */
  enabled?: boolean;
}

export interface UseGitObservationResult extends GitObservation {
  refresh: () => Promise<void>;
}

const NULL_RESULT: UseGitObservationResult = {
  status: null,
  diffStats: null,
  error: null,
  lastFetchedAt: null,
  refresh: async () => undefined,
};

export function useGitObservation(
  sessionId: string | null,
  options?: UseGitObservationOptions,
): UseGitObservationResult {
  const enabled = options?.enabled !== false;
  const id = sessionId && enabled ? sessionId : "";
  const slice = useGitObservationValue(id);

  useEffect(() => {
    if (!id) {
      return;
    }
    acquire(id);

    return () => release(id);
  }, [id]);

  if (!id) {
    return NULL_RESULT;
  }

  return {
    status: slice?.status ?? null,
    diffStats: slice?.diffStats ?? null,
    error: slice?.error ?? null,
    lastFetchedAt: slice?.lastFetchedAt ?? null,
    refresh: () => refreshGitObservation(id),
  };
}
