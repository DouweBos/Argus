/**
 * Quick open's data: the session's file index (fetched once per session, then
 * served from the store) fuzzy-matched against the query, changed files first.
 */

import {
  describeError,
  type FuzzyMatch,
  FuzzyFileMatcher,
} from "@argus/client-core";
import { useEffect, useMemo, useState } from "react";
import { useConnectionStore } from "../stores/connection";
import { useFilesStore } from "../stores/files";

export interface FileMatches {
  matches: FuzzyMatch[];
  /** No index yet. */
  loading: boolean;
  error: string | null;
  fileCount: number;
}

const EMPTY: string[] = [];

export function useFileMatches(
  sessionId: string,
  query: string,
  limit = 100,
): FileMatches {
  const connection = useConnectionStore((s) => s.connection);
  const hasControl = useConnectionStore((s) => s.hasControl());
  const index = useFilesStore((s) => s.indexBySession[sessionId]);
  const loadFileIndex = useFilesStore((s) => s.loadFileIndex);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (connection !== "ready" || !hasControl) {
      return;
    }
    // Refreshed on every open, served from the last list meanwhile.
    loadFileIndex(sessionId)
      .then(() => setError(null))
      .catch((err: unknown) => setError(describeError(err)));
  }, [connection, hasControl, sessionId, loadFileIndex]);

  const files = index?.files ?? EMPTY;
  const changed = index?.changed ?? EMPTY;
  const matcher = useMemo(() => new FuzzyFileMatcher(files), [files]);
  const boost = useMemo(() => new Set(changed), [changed]);
  const matches = useMemo(
    () => matcher.search(query, { boost, limit }),
    [matcher, query, boost, limit],
  );

  return {
    matches,
    loading: !index && !error,
    error: index ? null : error,
    fileCount: files.length,
  };
}
