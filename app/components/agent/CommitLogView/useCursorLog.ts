/**
 * Phase 4 H2 — cursor pagination hook for the commit log.
 *
 * Owns the loaded commits, in-flight request id (for race-cancellation), and
 * the next-cursor ref. Refetches from scratch whenever the filter
 * fingerprint changes.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useIpcEvent } from "../../../hooks/useIpcEvent";
import {
  gitSearchLog,
  type GitCommit,
  type LogSearchCursor,
  type LogSearchFilters,
} from "../../../lib/ipc";
import { GIT_STATUS_CHANGED_EVENT } from "../../../lib/types";

export interface UseCursorLogResult {
  commits: GitCommit[];
  error: string | null;
  hasMore: boolean;
  loading: boolean;
  loadingMore: boolean;
  loadMore: () => void;
  refresh: () => void;
}

export function useCursorLog(
  sessionId: string,
  filters: LogSearchFilters,
): UseCursorLogResult {
  const [commits, setCommits] = useState<GitCommit[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const cursorRef = useRef<LogSearchCursor | null>(null);
  const reqIdRef = useRef(0);
  const [refreshNonce, setRefreshNonce] = useState(0);

  // Fingerprint of the filters that warrants a full reset (clears commits and
  // shows the skeleton). Cursor isn't part of this — we control it ourselves.
  // refreshNonce is intentionally excluded — watcher-driven refreshes use a
  // separate "soft refresh" effect that keeps the current list visible while
  // the new fetch is in flight.
  const fp = JSON.stringify({
    sessionId,
    query: filters.query ?? "",
    author: filters.author ?? "",
    branch: filters.branch ?? "",
    since: filters.since ?? "",
    until: filters.until ?? "",
    refType: filters.refType ?? "all",
    paths: filters.paths ?? [],
  });

  useEffect(() => {
    cursorRef.current = null;
    setCommits([]);
    setLoading(true);
    setError(null);
    const myReq = ++reqIdRef.current;
    gitSearchLog(sessionId, { ...filters, cursor: null, limit: 50 })
      .then((res) => {
        if (myReq !== reqIdRef.current) {
          return;
        }
        setCommits(res.commits);
        cursorRef.current = res.nextCursor;
        setLoading(false);
      })
      .catch((err) => {
        if (myReq !== reqIdRef.current) {
          return;
        }
        setError(err instanceof Error ? err.message : String(err));
        setLoading(false);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fp]);

  // Soft refresh on watcher events — keeps the current list painted while we
  // refetch in the background. Avoids the empty-then-populated flash that
  // multi-step ops (interactive rebase, cherry-pick chains) trigger.
  useEffect(() => {
    if (refreshNonce === 0) {
      return;
    }
    const myReq = ++reqIdRef.current;
    gitSearchLog(sessionId, { ...filters, cursor: null, limit: 50 })
      .then((res) => {
        if (myReq !== reqIdRef.current) {
          return;
        }
        setCommits(res.commits);
        cursorRef.current = res.nextCursor;
      })
      .catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshNonce, fp]);

  const loadMore = useCallback(() => {
    if (loadingMore || cursorRef.current == null) {
      return;
    }
    setLoadingMore(true);
    const myReq = reqIdRef.current;
    gitSearchLog(sessionId, {
      ...filters,
      cursor: cursorRef.current,
      limit: 50,
    })
      .then((res) => {
        if (myReq !== reqIdRef.current) {
          return;
        }
        setCommits((cur) => [...cur, ...res.commits]);
        cursorRef.current = res.nextCursor;
        setLoadingMore(false);
      })
      .catch(() => {
        if (myReq !== reqIdRef.current) {
          return;
        }
        setLoadingMore(false);
      });
  }, [sessionId, filters, loadingMore]);

  const refresh = useCallback(() => {
    setRefreshNonce((n) => n + 1);
  }, []);

  // Refetch on git watcher events for this session — any git mutation
  // (commit, rebase, reset, cherry-pick, fetch, etc.) ultimately bumps a file
  // under .git/, which fires this event. Coalesced via a short debounce so
  // multi-step ops (interactive rebase applies one commit at a time, each
  // bumping the watcher) trigger a single refresh on the trailing edge
  // instead of one refresh per intermediate step.
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useIpcEvent<{ sessionId: string }>(GIT_STATUS_CHANGED_EVENT, (payload) => {
    if (payload.sessionId !== sessionId) {
      return;
    }
    if (debounceTimerRef.current !== null) {
      clearTimeout(debounceTimerRef.current);
    }
    debounceTimerRef.current = setTimeout(() => {
      debounceTimerRef.current = null;
      setRefreshNonce((n) => n + 1);
    }, 200);
  });
  useEffect(() => {
    return () => {
      if (debounceTimerRef.current !== null) {
        clearTimeout(debounceTimerRef.current);
      }
    };
  }, []);

  return {
    commits,
    loading,
    loadingMore,
    hasMore: cursorRef.current != null,
    error,
    loadMore,
    refresh,
  };
}
