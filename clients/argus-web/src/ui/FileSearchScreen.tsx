/**
 * Search across a session's worktree: typing settles, then one search runs
 * and its matches stream in grouped by file. Leaving the screen stops it;
 * the query and results stay for the next visit.
 */

import { matchPreviewParts, type FileSearchGroup } from "@argus/client-core";
import {
  Banner,
  type FileSearchFileGroup,
  FileSearchPanel,
  type FileSearchStatus,
} from "@argus/peacock";
import { useEffect, useMemo, useRef } from "react";
import { openFile } from "../routing/openFile";
import { useConnectionStore } from "../stores/connection";
import { EMPTY_SEARCH, useFileSearchStore } from "../stores/fileSearch";

const DEBOUNCE_MS = 350;

function toPanelGroups(groups: FileSearchGroup[]): FileSearchFileGroup[] {
  return groups.map((g) => ({
    path: g.path,
    hits: g.matches.map((m, i) => ({
      key: `${m.line}:${m.column}:${i}`,
      line: m.line,
      ...matchPreviewParts(m),
    })),
  }));
}

export function FileSearchScreen({ sessionId }: { sessionId: string }) {
  const connection = useConnectionStore((s) => s.connection);
  const hasControl = useConnectionStore((s) => s.hasControl());
  const search = useFileSearchStore((s) => s.bySession[sessionId]) ?? EMPTY_SEARCH;
  const setQuery = useFileSearchStore((s) => s.setQuery);
  const setOptions = useFileSearchStore((s) => s.setOptions);
  const run = useFileSearchStore((s) => s.run);
  const cancel = useFileSearchStore((s) => s.cancel);
  const ran = useRef<string | null>(null);
  const { query, options, results } = search;
  const signature = `${query}\u0000${options.regex}${options.caseSensitive}${options.wholeWord}`;

  // Run once typing settles; a query already searched (a return visit) isn't rerun.
  useEffect(() => {
    if (connection !== "ready" || !hasControl) {
      return;
    }
    if (ran.current === null && results.phase.kind !== "idle") {
      ran.current = signature;
    }
    if (ran.current === signature) {
      return;
    }
    const timer = setTimeout(() => {
      ran.current = signature;
      void run(sessionId);
    }, DEBOUNCE_MS);

    return () => clearTimeout(timer);
  }, [connection, hasControl, signature, sessionId, run, results.phase.kind]);

  useEffect(() => () => void cancel(sessionId), [sessionId, cancel]);

  const groups = useMemo(() => toPanelGroups(results.groups), [results.groups]);
  const status: FileSearchStatus = results.phase;

  return (
    <FileSearchPanel
      autoFocus={!query}
      disabled={!hasControl}
      groups={groups}
      notice={
        !hasControl && (
          <Banner tone="warning">
            Searching files needs control access. Pair this browser with
            control to search.
          </Banner>
        )
      }
      options={options}
      query={query}
      status={status}
      onOpenHit={(path, line) => openFile(sessionId, path, "search", line)}
      onOptionsChange={(next) => setOptions(sessionId, next)}
      onQueryChange={(next) => setQuery(sessionId, next)}
    />
  );
}
