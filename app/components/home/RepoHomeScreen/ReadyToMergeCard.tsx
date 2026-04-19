import { useEffect, useState } from "react";
import { DiffStat, Icons } from "@argus/peacock";
import { useMergeStatus } from "../../../hooks/useMergeStatus";
import { listen } from "../../../lib/events";
import { watchWorkspace } from "../../../lib/ipc";
import { setActiveTool } from "../../../stores/layoutStore";
import styles from "./ReadyToMergeCard.module.css";

interface DiffStats {
  additions: number;
  deletions: number;
  files: number;
}

interface ReadyToMergeCardProps {
  baseBranch?: string | null;
  sectionClassName?: string;
  titleClassName?: string;
  workspaceId: string;
}

export function ReadyToMergeCard({
  workspaceId,
  baseBranch,
  sectionClassName,
  titleClassName,
}: ReadyToMergeCardProps) {
  const { commitsAhead, conflicts, hasStaged, isMerging, handleMerge } =
    useMergeStatus(workspaceId);
  const [diffStats, setDiffStats] = useState<DiffStats | null>(null);

  useEffect(() => {
    let cancelled = false;
    const unlistenPromise = listen<DiffStats>(
      `workspace:diff-changed:${workspaceId}`,
      (event) => {
        if (!cancelled) {
          setDiffStats(event.payload);
        }
      },
    );
    watchWorkspace(workspaceId).catch(() => {});

    return () => {
      cancelled = true;
      unlistenPromise.then((fn) => fn());
    };
  }, [workspaceId]);

  const hasUncommitted = (diffStats?.files ?? 0) > 0;
  const hasWork = commitsAhead > 0 || hasStaged || hasUncommitted;
  if (!hasWork) {
    return null;
  }

  const hasConflicts = conflicts.length > 0;
  const canMerge =
    (hasStaged || commitsAhead > 0) && !hasConflicts && !isMerging;

  const baseLabel = baseBranch ?? "parent";

  let statusLine: string;
  if (hasConflicts) {
    statusLine = `${conflicts.length} conflict${conflicts.length === 1 ? "" : "s"} with ${baseLabel}`;
  } else if (commitsAhead > 0 && hasUncommitted) {
    statusLine = `${commitsAhead} commit${commitsAhead === 1 ? "" : "s"} ahead · uncommitted changes`;
  } else if (commitsAhead > 0) {
    statusLine = `${commitsAhead} commit${commitsAhead === 1 ? "" : "s"} ahead of ${baseLabel}`;
  } else if (hasStaged) {
    statusLine = "Staged changes ready to commit";
  } else {
    statusLine = "Uncommitted changes";
  }

  const handleReview = () => setActiveTool("changes");

  const content = (
    <div className={styles.card}>
      <div className={styles.row}>
        <div
          className={styles.iconWrap}
          data-tone={hasConflicts ? "warn" : "ok"}
        >
          <Icons.MergeIcon size={14} />
        </div>
        <div className={styles.body}>
          <div className={styles.title}>
            {hasConflicts ? "Merge blocked" : "Ready to merge"}
            {baseBranch && !hasConflicts && (
              <span className={styles.target}>
                {" into "}
                <span className={styles.branch}>{baseBranch}</span>
              </span>
            )}
          </div>
          <div className={styles.meta}>
            <span>{statusLine}</span>
            {diffStats && diffStats.files > 0 && (
              <>
                <span className={styles.sep}>·</span>
                <DiffStat
                  added={diffStats.additions}
                  removed={diffStats.deletions}
                  files={diffStats.files}
                />
              </>
            )}
          </div>
        </div>
        <div className={styles.actions}>
          <button
            className={styles.secondaryBtn}
            type="button"
            onClick={handleReview}
          >
            Review
          </button>
          {baseBranch && (
            <button
              className={styles.mergeBtn}
              disabled={!canMerge}
              title={
                hasConflicts
                  ? `Resolve ${conflicts.length} conflict${conflicts.length === 1 ? "" : "s"} first`
                  : `Merge into ${baseBranch}`
              }
              type="button"
              onClick={handleMerge}
            >
              <Icons.MergeIcon size={11} />
              {isMerging ? "Merging\u2026" : "Merge"}
            </button>
          )}
        </div>
      </div>
    </div>
  );

  if (sectionClassName || titleClassName) {
    return (
      <div className={sectionClassName}>
        {titleClassName && <h2 className={titleClassName}>Changes</h2>}
        {content}
      </div>
    );
  }

  return content;
}
