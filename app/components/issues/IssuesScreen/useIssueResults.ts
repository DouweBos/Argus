import type { IssueScope } from "../../../lib/router";
import { useEffect } from "react";
import {
  refreshLinearIssues,
  searchLinearIssues,
  useLinearConnected,
  useLinearIssueList,
  useLinearIssueSearch,
} from "../../../stores/linearIssuesStore";

/** The issues the screen shows: a scope's list, or the workspace search for `query`. */
export function useIssueResults(scope: IssueScope, query: string | null) {
  const connected = useLinearConnected();
  const list = useLinearIssueList(scope === "search" ? "assigned" : scope);
  const search = useLinearIssueSearch();

  useEffect(() => {
    if (!connected) {
      return;
    }
    if (scope !== "search") {
      refreshLinearIssues(scope).catch(() => {});
    } else if (query) {
      searchLinearIssues(query).catch(() => {});
    }
  }, [connected, scope, query]);

  if (scope !== "search") {
    return { ...list, refresh: () => refreshLinearIssues(scope) };
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
    refresh: () => searchLinearIssues(query),
  };
}
