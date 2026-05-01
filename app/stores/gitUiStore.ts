/**
 * Imperative cross-component messaging for the git view.
 *
 * Replaces the `window.dispatchEvent("argus:git-focus-commit")` smell —
 * `DiffViewer` requests focus, `CommitPanel` subscribes via the hook below.
 * Add new "request → handler" pairs here as the git view grows so we don't
 * accumulate more `CustomEvent` channels on `window`.
 */

import { useEffect } from "react";
import { create } from "zustand";

interface ComparisonRange {
  from: string;
  to: string;
}

/**
 * Phase 4 H3 — composite filter state for the History / Branch views.
 * Mirrors `LogSearchFilters` minus pagination.
 */
export interface HistoryFilters {
  author: string;
  branch: string;
  query: string;
  refType: "all" | "locals" | "remotes" | "tags";
  since: string;
  until: string;
}

export const EMPTY_HISTORY_FILTERS: HistoryFilters = {
  query: "",
  author: "",
  branch: "",
  since: "",
  until: "",
  refType: "all",
};

interface FileHistoryRequest {
  path: string;
}

interface GitUiState {
  /**
   * Phase 3 K3 — endpoints for `Cmd+Click` "compare A..B" requests in the
   * history view. The actual diff lands in Phase 4 H4; for now we surface a
   * banner.
   */
  comparisonRange: ComparisonRange | null;
  /**
   * Per-session expanded folder paths in tree mode. Stored as plain Maps so a
   * single Zustand subscription rerenders all readers when any session toggles.
   */
  expandedFolders: Map<string, Set<string>>;
  /** Phase 4 H8 — request to open file history view, scoped per session. */
  fileHistoryBySession: Map<string, FileHistoryRequest | null>;
  /**
   * Optional commit hash payload for the most recent focus request. Empty
   * string means "focus the composer subject" (the original Phase 1 use).
   */
  focusCommitHash: string;
  /** Monotonic counter — every increment is a fresh "focus commit" request. */
  focusCommitNonce: number;
  /** Phase 4 H3 — last-used filters per session. Reset on session change. */
  historyFiltersBySession: Map<string, HistoryFilters>;
}

const store = create<GitUiState>(() => ({
  focusCommitNonce: 0,
  focusCommitHash: "",
  expandedFolders: new Map(),
  comparisonRange: null,
  historyFiltersBySession: new Map(),
  fileHistoryBySession: new Map(),
}));

/**
 * Imperatively request that the commit-composer subject input be focused.
 * If `hash` is provided the consumer (history view) can choose to scroll
 * that commit into view instead — see `useFocusCommitHash`.
 */
export function requestFocusCommit(hash?: string): void {
  store.setState((s) => ({
    focusCommitNonce: s.focusCommitNonce + 1,
    focusCommitHash: hash ?? "",
  }));
}

export function useFocusCommitHash(): string {
  return store((s) => s.focusCommitHash);
}

export function useComparisonRange(): ComparisonRange | null {
  return store((s) => s.comparisonRange);
}

export function setComparisonRange(range: ComparisonRange): void {
  store.setState({ comparisonRange: range });
}

export function clearComparisonRange(): void {
  store.setState({ comparisonRange: null });
}

/** Tree-mode expanded-folder set for a given session. */
export function useExpandedFolders(sessionId: string): Set<string> {
  return store((s) => s.expandedFolders.get(sessionId) ?? EMPTY_SET);
}

const EMPTY_SET = new Set<string>();

/** Toggle a folder path's expansion state for the given session. */
export function toggleExpandedFolder(sessionId: string, path: string): void {
  store.setState((s) => {
    const next = new Map(s.expandedFolders);
    const existing = next.get(sessionId) ?? new Set<string>();
    const updated = new Set(existing);
    if (updated.has(path)) {
      updated.delete(path);
    } else {
      updated.add(path);
    }
    next.set(sessionId, updated);

    return { expandedFolders: next };
  });
}

/** History filter state per session. */
export function useHistoryFilters(sessionId: string): HistoryFilters {
  return store(
    (s) => s.historyFiltersBySession.get(sessionId) ?? EMPTY_HISTORY_FILTERS,
  );
}

export function setHistoryFilters(
  sessionId: string,
  filters: HistoryFilters,
): void {
  store.setState((s) => {
    const next = new Map(s.historyFiltersBySession);
    next.set(sessionId, filters);

    return { historyFiltersBySession: next };
  });
}

export function clearHistoryFiltersForSession(sessionId: string): void {
  store.setState((s) => {
    if (!s.historyFiltersBySession.has(sessionId)) {
      return s;
    }
    const next = new Map(s.historyFiltersBySession);
    next.delete(sessionId);

    return { historyFiltersBySession: next };
  });
}

/** Phase 4 H8 — file history request scoped per session. */
export function useFileHistoryRequest(
  sessionId: string,
): FileHistoryRequest | null {
  return store((s) => s.fileHistoryBySession.get(sessionId) ?? null);
}

export function openFileHistory(sessionId: string, path: string): void {
  store.setState((s) => {
    const next = new Map(s.fileHistoryBySession);
    next.set(sessionId, { path });

    return { fileHistoryBySession: next };
  });
}

export function closeFileHistory(sessionId: string): void {
  store.setState((s) => {
    const next = new Map(s.fileHistoryBySession);
    next.set(sessionId, null);

    return { fileHistoryBySession: next };
  });
}

/**
 * Subscribe to focus-commit requests. The handler runs once per request
 * (i.e. once per `requestFocusCommit()` call).
 */
export function useFocusCommitRequests(handler: () => void): void {
  useEffect(() => {
    let last = store.getState().focusCommitNonce;
    const unsubscribe = store.subscribe((state) => {
      if (state.focusCommitNonce !== last) {
        last = state.focusCommitNonce;
        handler();
      }
    });

    return unsubscribe;
  }, [handler]);
}
