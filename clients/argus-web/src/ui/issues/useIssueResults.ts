/** The issues a list shows: a scope's open issues, or the workspace search for `query`. */

import { useEffect } from "react";
import type { IssueScope } from "@argus/client-core";
import { useConnectionStore } from "../../stores/connection";
import {
  type IssueList,
  refreshIssues,
  searchIssues,
  useIssuesStore,
} from "../../stores/issues";

export function useIssueResults(
  scope: IssueScope,
  query: string | null,
): IssueList & { refresh: () => Promise<void> } {
  const ready = useConnectionStore((s) => s.connection === "ready");
  const list = useIssuesStore((s) =>
    scope === "search" ? null : s.lists[scope],
  );
  const search = useIssuesStore((s) => s.search);

  useEffect(() => {
    if (!ready) {
      return;
    }
    if (scope !== "search") {
      refreshIssues(scope, { background: true }).catch(() => {});
    } else if (query) {
      searchIssues(query).catch(() => {});
    }
  }, [ready, scope, query]);

  if (list && scope !== "search") {
    return { ...list, refresh: () => refreshIssues(scope) };
  }
  if (!query) {
    return {
      data: [],
      error: null,
      loading: false,
      refresh: () => Promise.resolve(),
    };
  }
  const current = search.term === query;

  return {
    data: current ? search.data : null,
    error: current ? search.error : null,
    loading: search.loading,
    refresh: () => searchIssues(query),
  };
}
