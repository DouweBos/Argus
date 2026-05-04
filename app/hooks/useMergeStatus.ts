import { useCallback, useEffect, useState } from "react";
import {
  getSessionCommitsAhead,
  getSessionCommitsBehind,
  getSessionConflicts,
  getSessionStagedDiff,
  mergeSessionIntoBase,
  rebaseSessionOnBase,
} from "../lib/ipc";
import { pushError } from "../stores/notificationsStore";
import { useIpcEvent } from "./useIpcEvent";

interface UseMergeStatusResult {
  commitsAhead: number;
  commitsBehind: number;
  conflicts: string[];
  /** Returns `true` when the merge completed successfully, `false` otherwise. */
  handleMerge: () => Promise<boolean>;
  handleRebase: () => Promise<void>;
  hasStaged: boolean;
  isMerging: boolean;
  isRebasing: boolean;
  mergeError: string | null;
  rebaseError: string | null;
}

export function useMergeStatus(sessionId: string | null): UseMergeStatusResult {
  const [conflicts, setConflicts] = useState<string[]>([]);
  const [hasStaged, setHasStaged] = useState(false);
  const [commitsAhead, setCommitsAhead] = useState(0);
  const [commitsBehind, setCommitsBehind] = useState(0);
  const [isMerging, setIsMerging] = useState(false);
  const [isRebasing, setIsRebasing] = useState(false);
  const [mergeError, setMergeError] = useState<string | null>(null);
  const [rebaseError, setRebaseError] = useState<string | null>(null);

  const fetchStatus = useCallback(async () => {
    if (!sessionId) {
      return;
    }
    try {
      const [conflictResult, stagedDiff, ahead, behind] = await Promise.all([
        getSessionConflicts(sessionId),
        getSessionStagedDiff(sessionId),
        getSessionCommitsAhead(sessionId),
        getSessionCommitsBehind(sessionId),
      ]);
      setConflicts(conflictResult);
      setHasStaged(stagedDiff.trim() !== "");
      setCommitsAhead(ahead);
      setCommitsBehind(behind);
    } catch {
      // ignore
    }
  }, [sessionId]);

  useEffect(() => {
    fetchStatus();
  }, [fetchStatus]);

  useIpcEvent(
    sessionId ? `session:diff-changed:${sessionId}` : "",
    fetchStatus,
  );

  const handleMerge = useCallback(async (): Promise<boolean> => {
    if (!sessionId) {
      return false;
    }
    setIsMerging(true);
    setMergeError(null);
    try {
      await mergeSessionIntoBase(sessionId);

      return true;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setMergeError(message);
      pushError(message, "Merge failed");
      // Refresh conflict list so the UI can surface "Fix in chat".
      await fetchStatus();

      return false;
    } finally {
      setIsMerging(false);
    }
  }, [sessionId, fetchStatus]);

  const handleRebase = useCallback(async () => {
    if (!sessionId) {
      return;
    }
    setIsRebasing(true);
    setRebaseError(null);
    try {
      await rebaseSessionOnBase(sessionId);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setRebaseError(message);
      pushError(message, "Rebase failed");
    } finally {
      setIsRebasing(false);
      await fetchStatus();
    }
  }, [sessionId, fetchStatus]);

  return {
    commitsAhead,
    commitsBehind,
    conflicts,
    hasStaged,
    isMerging,
    isRebasing,
    mergeError,
    rebaseError,
    handleMerge,
    handleRebase,
  };
}
