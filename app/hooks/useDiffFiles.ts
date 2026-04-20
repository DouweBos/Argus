import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { type DiffFile, mergeStaged, parseDiff } from "../lib/diffParser";
import {
  getSessionBranchDiff,
  getSessionConflicts,
  getSessionFullDiff,
  getSessionStagedDiff,
  getSessionUntrackedDiff,
  watchSession,
} from "../lib/ipc";
import { useIpcEvent } from "./useIpcEvent";

interface UseDiffFilesOptions {
  baseBranch?: string | null;
}

interface UseDiffFilesResult {
  conflictFiles: string[];
  error: string | null;
  files: DiffFile[];
  isLoading: boolean;
  refetch: () => Promise<void>;
}

export function useDiffFiles(
  sessionId: string,
  options?: UseDiffFilesOptions,
): UseDiffFilesResult {
  const baseBranch = options?.baseBranch;
  const [fullDiff, setFullDiff] = useState<string | null>(null);
  const [stagedDiff, setStagedDiff] = useState<string | null>(null);
  const [untrackedDiff, setUntrackedDiff] = useState<string | null>(null);
  const [conflictFiles, setConflictFiles] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const isMounted = useRef(true);

  useEffect(() => {
    isMounted.current = true;

    return () => {
      isMounted.current = false;
    };
  }, []);

  const fetchAll = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      // When a base branch is known, show the entire branch diff
      // (committed + staged + unstaged vs base merge-base) so the user sees
      // all work that will be merged — not just uncommitted changes.
      const fullPromise = baseBranch
        ? getSessionBranchDiff(sessionId)
        : getSessionFullDiff(sessionId);
      const [full, staged, untracked] = await Promise.all([
        fullPromise,
        baseBranch ? Promise.resolve("") : getSessionStagedDiff(sessionId),
        getSessionUntrackedDiff(sessionId),
      ]);
      if (isMounted.current) {
        setFullDiff(full);
        setStagedDiff(staged);
        setUntrackedDiff(untracked);
      }
    } catch (err) {
      if (isMounted.current) {
        setError(err instanceof Error ? err.message : "Failed to load diff");
      }
    } finally {
      if (isMounted.current) {
        setIsLoading(false);
      }
    }

    // Fetch conflicts alongside diffs
    if (!baseBranch) {
      setConflictFiles([]);
    } else {
      try {
        const conflicts = await getSessionConflicts(sessionId);
        if (isMounted.current) {
          setConflictFiles(conflicts);
        }
      } catch {
        if (isMounted.current) {
          setConflictFiles([]);
        }
      }
    }
  }, [sessionId, baseBranch]);

  useEffect(() => {
    fetchAll();
  }, [fetchAll]);

  // Ensure the backend file watcher is running.
  useEffect(() => {
    watchSession(sessionId).catch(() => {});
  }, [sessionId]);

  useIpcEvent(`session:diff-changed:${sessionId}`, () => {
    fetchAll();
  });

  const files = useMemo(() => {
    if (!fullDiff && !untrackedDiff) {
      return [];
    }
    const parsed = fullDiff ? parseDiff(fullDiff) : [];
    const merged = stagedDiff ? mergeStaged(parsed, stagedDiff) : parsed;
    if (untrackedDiff && untrackedDiff.trim()) {
      const untracked = parseDiff(untrackedDiff);
      for (const f of untracked) {
        f.staged = "none";
        f.status = "A";
      }

      return [...merged, ...untracked];
    }

    return merged;
  }, [fullDiff, stagedDiff, untrackedDiff]);

  return { files, conflictFiles, isLoading, error, refetch: fetchAll };
}
