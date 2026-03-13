import { useState, useEffect, useCallback } from "react";
import { useWorkspaceStore } from "../../stores/workspaceStore";
import { useIpcEvent } from "../../hooks/useIpcEvent";
import {
  getWorkspaceConflicts,
  getWorkspaceStagedDiff,
  mergeWorkspaceIntoBase,
} from "../../lib/ipc";
import { MergeIcon } from "../shared/Icons";
import styles from "./MergeBar.module.css";

interface MergeBarProps {
  workspaceId: null | string;
}

export function MergeBar({ workspaceId }: MergeBarProps) {
  const workspace = useWorkspaceStore((s) =>
    workspaceId
      ? (s.workspaces.find((w) => w.id === workspaceId) ?? null)
      : null,
  );

  const [conflicts, setConflicts] = useState<string[]>([]);
  const [hasStaged, setHasStaged] = useState(false);
  const [isMerging, setIsMerging] = useState(false);
  const [mergeError, setMergeError] = useState<null | string>(null);

  const fetchStatus = useCallback(async () => {
    if (!workspaceId) return;
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
    if (!workspaceId) return;
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

  if (!workspace || workspace.kind !== "worktree" || !workspace.base_branch) {
    return null;
  }

  const hasConflicts = conflicts.length > 0;
  const canMerge = hasStaged && !hasConflicts && !isMerging;

  return (
    <>
      <div
        className={`${styles.bar} ${hasConflicts ? styles.barConflict : hasStaged ? styles.barReady : styles.barNoStaged}`}
      >
        <span
          className={`${styles.statusText} ${hasConflicts ? styles.statusTextConflict : hasStaged ? styles.statusTextReady : styles.statusTextNoStaged}`}
        >
          {hasConflicts
            ? `${conflicts.length} conflict${conflicts.length > 1 ? "s" : ""}`
            : hasStaged
              ? "Ready to merge"
              : "Stage changes to merge"}
        </span>
        <button
          className={styles.mergeBtn}
          onClick={handleMerge}
          disabled={!canMerge}
          title={
            !hasStaged
              ? "No staged changes to merge"
              : `Merge ${workspace.branch} into ${workspace.base_branch}`
          }
        >
          <MergeIcon />
          {isMerging ? "Merging..." : "Merge"}
        </button>
      </div>
      {mergeError && <div className={styles.error}>{mergeError}</div>}
    </>
  );
}
