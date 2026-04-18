import { useCallback, useEffect, useMemo, useState } from "react";
import { Button, Icons } from "@argus/peacock";
import { useIpcEvent } from "../../../hooks/useIpcEvent";
import {
  getWorkspaceCommitsAhead,
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
  const hasMergeableWork = hasStaged || commitsAhead > 0;
  const canMerge = hasMergeableWork && !hasConflicts && !isMerging;

  let mergeBtnTitle: string;
  if (hasConflicts) {
    mergeBtnTitle = `${conflicts.length} conflict${conflicts.length === 1 ? "" : "s"} — resolve before merging into ${workspace.base_branch}`;
  } else if (!hasMergeableWork) {
    mergeBtnTitle = `Stage changes in this workspace, then merge into ${workspace.base_branch}`;
  } else if (hasStaged && commitsAhead > 0) {
    mergeBtnTitle = `Commits staged changes on ${workspace.branch}, then merges into ${workspace.base_branch} (${commitsAhead} existing commit${commitsAhead === 1 ? "" : "s"} also included)`;
  } else if (hasStaged) {
    mergeBtnTitle = `Commits staged changes on ${workspace.branch}, then merges into ${workspace.base_branch}`;
  } else {
    mergeBtnTitle = `Merges ${commitsAhead} commit${commitsAhead === 1 ? "" : "s"} from ${workspace.branch} into ${workspace.base_branch}`;
  }

  let barToneClass = styles.barNoStaged;
  let statusTextToneClass = styles.statusTextNoStaged;
  let statusLabel: string;
  if (hasConflicts) {
    barToneClass = styles.barConflict;
    statusTextToneClass = styles.statusTextConflict;
    statusLabel = `${conflicts.length} conflict${conflicts.length > 1 ? "s" : ""}`;
  } else if (hasMergeableWork) {
    barToneClass = styles.barReady;
    statusTextToneClass = styles.statusTextReady;
    statusLabel =
      commitsAhead > 0 && !hasStaged
        ? `${commitsAhead} commit${commitsAhead === 1 ? "" : "s"} ready to merge`
        : "Ready to merge";
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
          title={mergeBtnTitle}
          onClick={handleMerge}
        >
          {isMerging ? "Merging..." : "Merge"}
        </Button>
      </div>
      {mergeError && <div className={styles.error}>{mergeError}</div>}
    </>
  );
}
