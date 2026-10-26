import type { ClaudeUsageLimits } from "../../lib/types";
import { useCallback, useEffect, useRef, useState } from "react";
import { getClaudeUsageLimits } from "../../lib/ipc";

const POLL_MS = 60_000;

export interface UsageLimitsState {
  data: ClaudeUsageLimits | null;
  error: string | null;
  loading: boolean;
  /** When the last answer landed; reset countdowns are measured from it. */
  now: number;
  refresh: () => void;
  refreshing: boolean;
}

/** Plan limits, polled every minute while mounted (the host caches as long). */
export function useUsageLimits(): UsageLimitsState {
  const [data, setData] = useState<ClaudeUsageLimits | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const alive = useRef(true);

  const load = useCallback((force: boolean) => {
    getClaudeUsageLimits(force)
      .then((next) => {
        if (alive.current) {
          setData(next);
          setError(null);
        }
      })
      .catch((e: unknown) => {
        if (alive.current) {
          setError(String(e));
        }
      })
      .finally(() => {
        if (alive.current) {
          setNow(Date.now());
          setLoading(false);
          setRefreshing(false);
        }
      });
  }, []);

  useEffect(() => {
    alive.current = true;
    load(false);
    const timer = setInterval(() => load(false), POLL_MS);

    return () => {
      alive.current = false;
      clearInterval(timer);
    };
  }, [load]);

  const refresh = useCallback(() => {
    setRefreshing(true);
    load(true);
  }, [load]);

  return { data, error, loading, now, refresh, refreshing };
}
