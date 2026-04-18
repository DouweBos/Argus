import { useCallback, useEffect, useMemo, useState } from "react";
import { Button, Icons } from "@argus/peacock";
import { useIpcEvent } from "../../../hooks/useIpcEvent";
import {
  getWorkspaceConflicts,
  getWorkspaceStagedDiff,
  mergeWorkspaceIntoBase,
} from "../../../lib/ipc";
import { useWorkspaces } from "../../../stores/workspaceStore";
import styles from "./MergeBar.module.css";

interface MergeBarProps {
  workspaceId: string | null;
}

export function MergeBar({ workspaceId }: MergeBarProps) {
  const workspaces = useWorkspaces();
  const workspace = useMemo(
    () =>
      workspaceId
        ? (workspaces.find((w) => w.id === workspaceId) ?? null)
        : null,
    [workspaceId, workspaces],
  );

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

  if (!workspace || workspace.kind !== "worktree" || !workspace.base_branch) {
    return null;
  }

  const hasConflicts = conflicts.length > 0;
  const canMerge = hasStaged && !hasConflicts && !isMerging;

  let barToneClass = styles.barNoStaged;
  let statusTextToneClass = styles.statusTextNoStaged;
  let statusLabel: string;
  if (hasConflicts) {
    barToneClass = styles.barConflict;
    statusTextToneClass = styles.statusTextConflict;
    statusLabel = `${conflicts.length} conflict${conflicts.length > 1 ? "s" : ""}`;
  } else if (hasStaged) {
    barToneClass = styles.barReady;
    statusTextToneClass = styles.statusTextReady;
    statusLabel = "Ready to merge";
  } else {
    statusLabel = "Stage changes to merge";
  }

  return (
    <>
      <div className={`${styles.bar} ${barToneClass}`}>
        <span className={`${styles.statusText} ${statusTextToneClass}`}>
          {statusLabel}
        </span>
        <Button
          disabled={!canMerge}
          leading={<Icons.MergeIcon size={11} />}
          size="sm"
          variant="primary"
          title={
            !hasStaged
              ? "No staged changes to merge"
              : `Merge ${workspace.branch} into ${workspace.base_branch}`
          }
          onClick={handleMerge}
        >
          {isMerging ? "Merging..." : "Merge"}
        </Button>
      </div>
      {mergeError && <div className={styles.error}>{mergeError}</div>}
    </>
  );
}
