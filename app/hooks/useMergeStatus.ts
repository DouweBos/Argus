import { useCallback, useEffect, useState } from "react";
import {
  getWorkspaceConflicts,
  getWorkspaceStagedDiff,
  mergeWorkspaceIntoBase,
} from "../lib/ipc";
import { useIpcEvent } from "./useIpcEvent";

interface UseMergeStatusResult {
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
  const [isMerging, setIsMerging] = useState(false);
  const [mergeError, setMergeError] = useState<string | null>(null);

  const fetchStatus = useCallback(async () => {
    if (!workspaceId) {
      return;
    }
    try {
      const [conflictResult, stagedDiff] = await Promise.all([
        getWorkspaceConflicts(workspaceId),
        getWorkspaceStagedDiff(workspaceId),
      ]);
      setConflicts(conflictResult);
      setHasStaged(stagedDiff.trim() !== "");
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

  return { conflicts, hasStaged, isMerging, mergeError, handleMerge };
}
