import { useCallback, useEffect, useState } from "react";
import {
  getWorkspaceCommitsAhead,
  getWorkspaceConflicts,
  getWorkspaceStagedDiff,
  mergeWorkspaceIntoBase,
} from "../lib/ipc";
import { useIpcEvent } from "./useIpcEvent";

interface UseMergeStatusResult {
  commitsAhead: number;
  conflicts: string[];
  handleMerge: () => Promise<void>;
  hasStaged: boolean;
  isMerging: boolean;
  mergeError: string | null;
}

export function useMergeStatus(
  workspaceId: string | null,
): UseMergeStatusResult {
  const [conflicts, setConflicts] = useState<string[]>([]);
  const [hasStaged, setHasStaged] = useState(false);
  const [commitsAhead, setCommitsAhead] = useState(0);
  const [isMerging, setIsMerging] = useState(false);
  const [mergeError, setMergeError] = useState<string | null>(null);

  const fetchStatus = useCallback(async () => {
    if (!workspaceId) {
      return;
    }
    try {
      const [conflictResult, stagedDiff, ahead] = await Promise.all([
        getWorkspaceConflicts(workspaceId),
        getWorkspaceStagedDiff(workspaceId),
        getWorkspaceCommitsAhead(workspaceId),
      ]);
      setConflicts(conflictResult);
      setHasStaged(stagedDiff.trim() !== "");
      setCommitsAhead(ahead);
    } catch {
      // ignore
    }
  }, [workspaceId]);

  useEffect(() => {
    fetchStatus();
  }, [fetchStatus]);

  useIpcEvent(
    workspaceId ? `workspace:diff-changed:${workspaceId}` : "",
    fetchStatus,
  );
  // Re-fetch when the workspace's review-queue state updates (e.g. a new
  // commit on the branch, or a sibling merge completion).
  useIpcEvent("workspace:review-state", fetchStatus);

  const handleMerge = useCallback(async () => {
    if (!workspaceId) {
      return;
    }
    setIsMerging(true);
    setMergeError(null);
    try {
      await mergeWorkspaceIntoBase(workspaceId);
    } catch (err) {
      setMergeError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsMerging(false);
    }
  }, [workspaceId]);

  return {
    commitsAhead,
    conflicts,
    hasStaged,
    isMerging,
    mergeError,
    handleMerge,
  };
}
