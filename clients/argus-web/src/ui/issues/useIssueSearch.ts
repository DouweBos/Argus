/**
 * The issue picker's list: your assigned issues until something is typed,
 * then the workspace search for it (or the issue a pasted ID names).
 */

import { useEffect, useState } from "react";
import { describeError } from "@argus/client-core";
import type { LinearIssue } from "@argus/remote-protocol";
import { request } from "../../lib/request";
import { currentTransport } from "../../stores/connection";

const DEBOUNCE_MS = 250;

export function useIssueSearch(active: boolean) {
  const [query, setQuery] = useState("");
  const [result, setResult] = useState<{
    error: string | null;
    issues: LinearIssue[];
    term: string;
  } | null>(null);
  const term = query.trim();

  useEffect(() => {
    const t = currentTransport();
    if (!active || !t) {
      return;
    }
    let cancelled = false;
    const timer = window.setTimeout(() => {
      request(
        t,
        "linear.issues",
        term ? { query: term, limit: 20 } : { scope: "assigned", limit: 50 },
      ).then(
        ({ issues }) =>
          !cancelled && setResult({ term, issues, error: null }),
        (err: unknown) =>
          !cancelled &&
          setResult({ term, issues: [], error: describeError(err) }),
      );
    }, DEBOUNCE_MS);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [active, term]);

  const current = result?.term === term ? result : null;

  return {
    query,
    setQuery,
    issues: current?.issues ?? result?.issues ?? [],
    error: current?.error ?? null,
    loading: current === null,
  };
}
