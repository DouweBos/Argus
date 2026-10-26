import type { ClaudeUsageSummary, UsageRange } from "../../lib/types";
import { useCallback, useEffect, useRef, useState } from "react";
import { getClaudeUsageSummary } from "../../lib/ipc";

const POLL_MS = 5 * 60_000;

export interface UsageSummaryState {
  /** Only ever the summary for the range asked for; null while it loads. */
  data: ClaudeUsageSummary | null;
  error: string | null;
  loading: boolean;
  refresh: () => void;
  refreshing: boolean;
}

interface Answer {
  data: ClaudeUsageSummary | null;
  error: string | null;
  range: UsageRange;
}

/**
 * Token and cost totals for `range`, refetched when it changes and every five
 * minutes while `enabled`. Off the cost and tokens tabs it fetches nothing.
 */
export function useUsageSummary(
  range: UsageRange,
  enabled: boolean,
): UsageSummaryState {
  const [answer, setAnswer] = useState<Answer | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  // Latest request wins: a slow scan for the old range must not overwrite the new one.
  const request = useRef(0);

  const load = useCallback((next: UsageRange) => {
    const id = ++request.current;
    getClaudeUsageSummary(next)
      .then((data) => {
        if (request.current === id) {
          setAnswer({ data, error: null, range: next });
        }
      })
      .catch((e: unknown) => {
        if (request.current === id) {
          setAnswer((prev) => ({
            data: prev?.range === next ? prev.data : null,
            error: String(e),
            range: next,
          }));
        }
      })
      .finally(() => {
        if (request.current === id) {
          setRefreshing(false);
        }
      });
  }, []);

  useEffect(() => {
    if (!enabled) {
      return;
    }
    load(range);
    const timer = setInterval(() => load(range), POLL_MS);

    return () => {
      request.current += 1;
      clearInterval(timer);
    };
  }, [enabled, load, range]);

  const refresh = useCallback(() => {
    setRefreshing(true);
    load(range);
  }, [load, range]);

  const current = answer?.range === range ? answer : null;

  return {
    data: current?.data ?? null,
    error: current?.error ?? null,
    loading: current === null,
    refresh,
    refreshing,
  };
}
