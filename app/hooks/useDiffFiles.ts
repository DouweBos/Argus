import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { type DiffFile, mergeStaged, parseDiff } from "../lib/diffParser";
import {
  getWorkspaceConflicts,
  getWorkspaceFullDiff,
  getWorkspaceStagedDiff,
  getWorkspaceUntrackedDiff,
  watchWorkspace,
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
  workspaceId: string,
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
      const [full, staged, untracked] = await Promise.all([
        getWorkspaceFullDiff(workspaceId),
        getWorkspaceStagedDiff(workspaceId),
        getWorkspaceUntrackedDiff(workspaceId),
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
        const conflicts = await getWorkspaceConflicts(workspaceId);
        if (isMounted.current) {
          setConflictFiles(conflicts);
        }
      } catch {
        if (isMounted.current) {
          setConflictFiles([]);
        }
      }
    }
  }, [workspaceId, baseBranch]);

  useEffect(() => {
    fetchAll();
  }, [fetchAll]);

  // Ensure the backend file watcher is running.
  useEffect(() => {
    watchWorkspace(workspaceId).catch(() => {});
  }, [workspaceId]);

  useIpcEvent(`workspace:diff-changed:${workspaceId}`, () => {
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
