/**
 * Worktree search, one at a time per session: a new query cancels the last,
 * and matches stream in over `files.search` events grouped by file. Mirrors
 * `FileSearchStore`; the grouping itself is `@argus/client-core`'s.
 */

import {
  beginFileSearch,
  describeError,
  detachFileSearch,
  failFileSearch,
  FILE_SEARCH_MAX_RESULTS,
  type FileSearchState,
  IDLE_FILE_SEARCH,
  NOT_CONNECTED_MESSAGE,
  receiveFileSearchEvent,
  resultBucket,
} from "@argus/client-core";
import type { FileSearchOptions } from "@argus/peacock";
import type { CodeSearchEvent } from "@argus/remote-protocol";
import { create } from "zustand";
import { request } from "../lib/request";
import { capture } from "../telemetry/telemetry";
import { currentTransport } from "./connection";

export interface SessionSearch {
  query: string;
  options: FileSearchOptions;
  results: FileSearchState;
}

const DEFAULT_OPTIONS: FileSearchOptions = {
  regex: false,
  caseSensitive: false,
  wholeWord: false,
};

export const EMPTY_SEARCH: SessionSearch = {
  query: "",
  options: DEFAULT_OPTIONS,
  results: IDLE_FILE_SEARCH,
};

interface FileSearchStoreState {
  /** What each session's search screen shows, kept across visits. */
  bySession: Record<string, SessionSearch>;

  setQuery: (sessionId: string, query: string) => void;
  setOptions: (sessionId: string, options: FileSearchOptions) => void;
  /** Search for the session's query; an empty one just clears. */
  run: (sessionId: string) => Promise<void>;
  cancel: (sessionId: string) => Promise<void>;
}

let nextId = 0;

function newSearchId(): string {
  nextId += 1;

  return `web-${Date.now().toString(36)}-${nextId}`;
}

function channel(searchId: string): string {
  return `code-search:${searchId}`;
}

export const useFileSearchStore = create<FileSearchStoreState>()(
  (set, get) => {
    const update = (sessionId: string, next: Partial<SessionSearch>) =>
      set((s) => ({
        bySession: {
          ...s.bySession,
          [sessionId]: { ...(s.bySession[sessionId] ?? EMPTY_SEARCH), ...next },
        },
      }));

    const stop = async (sessionId: string) => {
      const current = get().bySession[sessionId];
      const searchId = current?.results.searchId;
      if (!current || !searchId) {
        return;
      }
      update(sessionId, { results: detachFileSearch(current.results) });
      const t = currentTransport();
      if (!t) {
        return;
      }
      t.subscribe(channel(searchId), false);
      await request(t, "files.search_cancel", {
        session_id: sessionId,
        search_id: searchId,
      }).catch(() => {});
    };

    return {
      bySession: {},

      setQuery: (sessionId, query) => update(sessionId, { query }),

      setOptions: (sessionId, options) => update(sessionId, { options }),

      cancel: stop,

      run: async (sessionId) => {
        await stop(sessionId);
        const { query, options } = get().bySession[sessionId] ?? EMPTY_SEARCH;
        if (!query.trim()) {
          update(sessionId, { results: IDLE_FILE_SEARCH });

          return;
        }
        const t = currentTransport();
        if (!t) {
          update(sessionId, {
            results: failFileSearch(IDLE_FILE_SEARCH, NOT_CONNECTED_MESSAGE),
          });

          return;
        }
        const searchId = newSearchId();
        update(sessionId, { results: beginFileSearch(searchId) });
        // Subscribe first: matches can arrive before the answer does.
        t.subscribe(channel(searchId), true);
        try {
          await request(t, "files.search", {
            session_id: sessionId,
            search_id: searchId,
            query,
            regex: options.regex,
            case_sensitive: options.caseSensitive,
            whole_word: options.wholeWord,
            max_results: FILE_SEARCH_MAX_RESULTS,
          });
        } catch (err) {
          t.subscribe(channel(searchId), false);
          const results = get().bySession[sessionId]?.results;
          if (results?.searchId === searchId) {
            update(sessionId, {
              results: failFileSearch(results, describeError(err)),
            });
          }
        }
      },
    };
  },
);

/** A `files.search` event, for whichever session's search it belongs to. */
export function receiveFileSearch(event: CodeSearchEvent): void {
  const { bySession } = useFileSearchStore.getState();
  for (const [sessionId, search] of Object.entries(bySession)) {
    if (search.results.searchId !== event.searchId) {
      continue;
    }
    const { state, finished } = receiveFileSearchEvent(search.results, event);
    useFileSearchStore.setState((s) => ({
      bySession: { ...s.bySession, [sessionId]: { ...search, results: state } },
    }));
    if (state.searchId === null) {
      currentTransport()?.subscribe(channel(event.searchId), false);
    }
    if (finished) {
      capture("web_file_search_run", {
        regex: search.options.regex,
        result_bucket: resultBucket(finished.count),
        truncated: finished.truncated,
      });
    }

    return;
  }
}

export function resetFileSearch(): void {
  useFileSearchStore.setState({ bySession: {} });
}
