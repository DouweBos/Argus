/**
 * One worktree search at a time for one session, as a pure reducer: matches
 * stream in grouped by file in the order the host found them, ending with one
 * `done`. Events for any search but the current one are dropped. The TS twin
 * of ArgusCore's `FileSearchStore`.
 */

import type { CodeSearchEvent, CodeSearchMatch } from "@argus/remote-protocol";

export interface FileSearchGroup {
  path: string;
  matches: CodeSearchMatch[];
}

export type FileSearchPhase =
  | { kind: "done"; count: number; truncated: boolean }
  | { kind: "failed"; message: string }
  | { kind: "idle" }
  | { kind: "running" };

export interface FileSearchState {
  /** The search whose events count; null once it is done or detached. */
  searchId: string | null;
  groups: FileSearchGroup[];
  matchCount: number;
  phase: FileSearchPhase;
}

/** Matches past this stop the search; a list has no use for more. */
export const FILE_SEARCH_MAX_RESULTS = 2000;

export const IDLE_FILE_SEARCH: FileSearchState = {
  searchId: null,
  groups: [],
  matchCount: 0,
  phase: { kind: "idle" },
};

export function beginFileSearch(searchId: string): FileSearchState {
  return { ...IDLE_FILE_SEARCH, searchId, phase: { kind: "running" } };
}

/** Stop listening, keeping what has arrived. */
export function detachFileSearch(state: FileSearchState): FileSearchState {
  return {
    ...state,
    searchId: null,
    phase:
      state.phase.kind === "running"
        ? { kind: "done", count: state.matchCount, truncated: false }
        : state.phase,
  };
}

export function failFileSearch(
  state: FileSearchState,
  message: string,
): FileSearchState {
  return { ...state, searchId: null, phase: { kind: "failed", message } };
}

function append(
  groups: FileSearchGroup[],
  matches: readonly CodeSearchMatch[],
): FileSearchGroup[] {
  const next = [...groups];
  const index = new Map(next.map((g, i) => [g.path, i]));
  for (const match of matches) {
    const at = index.get(match.relativePath);
    if (at === undefined) {
      index.set(match.relativePath, next.length);
      next.push({ path: match.relativePath, matches: [match] });
    } else {
      next[at] = { ...next[at], matches: [...next[at].matches, match] };
    }
  }

  return next;
}

export interface FileSearchUpdate {
  state: FileSearchState;
  /** Set once, when the current search finished on its own (not cancelled). */
  finished?: { count: number; truncated: boolean };
}

export function receiveFileSearchEvent(
  state: FileSearchState,
  event: CodeSearchEvent,
): FileSearchUpdate {
  if (!state.searchId || event.searchId !== state.searchId) {
    return { state };
  }
  if (event.kind === "matches") {
    return {
      state: {
        ...state,
        groups: append(state.groups, event.matches),
        matchCount: state.matchCount + event.matches.length,
      },
    };
  }
  if (event.error) {
    return { state: failFileSearch(state, event.error) };
  }
  const count = Math.max(event.count, state.matchCount);
  const done: FileSearchState = {
    ...state,
    searchId: null,
    phase: { kind: "done", count, truncated: event.truncated },
  };

  return event.cancelled
    ? { state: done }
    : {
        state: done,
        finished: { count: state.matchCount, truncated: event.truncated },
      };
}

export type ResultBucket = "0" | "1-10" | "11-100" | "101-1000" | "1000+";

/** A count as telemetry may see it, the phone's buckets. */
export function resultBucket(count: number): ResultBucket {
  if (count <= 0) {
    return "0";
  }
  if (count <= 10) {
    return "1-10";
  }
  if (count <= 100) {
    return "11-100";
  }

  return count <= 1000 ? "101-1000" : "1000+";
}

/** A match's preview split around the matched text, for highlighting. */
export function matchPreviewParts(match: CodeSearchMatch): {
  before: string;
  match: string;
  after: string;
} {
  const start = Math.max(0, match.column - match.previewOffset);
  const end = Math.min(match.preview.length, start + match.length);

  return {
    before: match.preview.slice(0, start),
    match: match.preview.slice(start, end),
    after: match.preview.slice(end),
  };
}
