import { useEffect, useState } from "react";
import { DiffStat, Icons } from "@argus/peacock";
import { useFixConflictsInChat } from "../../../hooks/useFixConflictsInChat";
import { useMergeStatus } from "../../../hooks/useMergeStatus";
import { listen } from "../../../lib/events";
import { deleteSession, watchSession } from "../../../lib/ipc";
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
  sessionBranch?: string | null;
  sessionId: string;
  titleClassName?: string;
}

function summarizeRebaseError(raw: string): string {
  const conflictFiles = new Set<string>();
  const conflictRe = /Merge conflict in (\S+)/g;
  let m: RegExpExecArray | null;
  while ((m = conflictRe.exec(raw)) !== null) {
    conflictFiles.add(m[1]);
  }
  if (conflictFiles.size > 0) {
    const files = Array.from(conflictFiles);
    const first = files[0].split("/").pop() ?? files[0];
    if (files.length === 1) {
      return `Rebase failed: conflict in ${first}`;
    }

    return `Rebase failed: conflicts in ${first} and ${files.length - 1} other file${files.length - 1 === 1 ? "" : "s"}`;
  }
  const firstLine = raw.split("\n").find((line) => line.trim().length > 0);
  const snippet = (firstLine ?? raw).trim();

  return `Rebase failed: ${snippet.length > 140 ? `${snippet.slice(0, 140)}…` : snippet}`;
}

function getRebaseLabel(
  isRebasing: boolean,
  hasWork: boolean,
  baseBranch: string,
): string {
  if (isRebasing) {
    return hasWork ? "Rebasing…" : "Updating…";
  }

  return hasWork ? `Rebase onto ${baseBranch}` : `Update from ${baseBranch}`;
}

export function ReadyToMergeCard({
  sessionId,
  baseBranch,
  sessionBranch,
  sectionClassName,
  titleClassName,
}: ReadyToMergeCardProps) {
  const {
    commitsAhead,
    commitsBehind,
    conflicts,
    hasStaged,
    isMerging,
    isRebasing,
    rebaseError,
    handleMerge: performMerge,
    handleRebase,
  } = useMergeStatus(sessionId);
  const [diffStats, setDiffStats] = useState<DiffStats | null>(null);
  const [justMerged, setJustMerged] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const {
    dispatch: handleFixConflictsInChat,
    isDispatching: isDispatchingAgent,
  } = useFixConflictsInChat({
    sessionId,
    baseBranch,
    sessionBranch,
    conflicts,
  });

  useEffect(() => {
    let cancelled = false;
    const unlistenPromise = listen<DiffStats>(
      `session:diff-changed:${sessionId}`,
      (event) => {
        if (!cancelled) {
          setDiffStats(event.payload);
        }
      },
    );
    watchSession(sessionId).catch(() => {});

    return () => {
      cancelled = true;
      unlistenPromise.then((fn) => fn());
    };
  }, [sessionId]);

  const handleMerge = async () => {
    await performMerge();
    setJustMerged(true);
  };

  const handleDelete = async () => {
    setIsDeleting(true);
    try {
      // After a successful merge the session branch is squashed into the
      // base — safe to delete along with the worktree.
      await deleteSession(sessionId, true);
    } catch {
      setIsDeleting(false);
    }
  };

  const hasUncommitted = (diffStats?.files ?? 0) > 0;
  const hasWork = commitsAhead > 0 || hasStaged || hasUncommitted;
  const needsRebase = commitsBehind > 0 && conflicts.length === 0;
  if (!hasWork && !needsRebase && !justMerged) {
    return null;
  }

  const hasConflicts = conflicts.length > 0;
  const hasRebaseError = Boolean(rebaseError) && !isRebasing;
  const canMerge =
    (hasStaged || commitsAhead > 0) &&
    !hasConflicts &&
    !hasRebaseError &&
    !isMerging;

  const baseLabel = baseBranch ?? "parent";

  let statusLine: string;
  if (justMerged) {
    statusLine = baseBranch ? `Merged into ${baseBranch}` : "Merged";
  } else if (hasConflicts) {
    statusLine = `${conflicts.length} conflict${conflicts.length === 1 ? "" : "s"} with ${baseLabel}`;
  } else if (rebaseError) {
    statusLine = summarizeRebaseError(rebaseError);
  } else if (commitsAhead > 0 && commitsBehind > 0) {
    statusLine = `${commitsAhead} ahead · ${commitsBehind} behind ${baseLabel}`;
  } else if (commitsAhead > 0 && hasUncommitted) {
    statusLine = `${commitsAhead} commit${commitsAhead === 1 ? "" : "s"} ahead · uncommitted changes`;
  } else if (commitsAhead > 0) {
    statusLine = `${commitsAhead} commit${commitsAhead === 1 ? "" : "s"} ahead of ${baseLabel}`;
  } else if (commitsBehind > 0) {
    statusLine = `${commitsBehind} commit${commitsBehind === 1 ? "" : "s"} behind ${baseLabel}`;
  } else if (hasStaged) {
    statusLine = "Staged changes ready to commit";
  } else {
    statusLine = "Uncommitted changes";
  }

  const handleReview = () => setActiveTool("changes");

  let title: string;
  let tone: "ok" | "warn" = "ok";
  if (justMerged) {
    title = "Merged";
  } else if (hasConflicts) {
    title = "Merge blocked";
    tone = "warn";
  } else if (hasRebaseError) {
    title = `Rebase onto ${baseLabel} failed`;
    tone = "warn";
  } else if (!hasWork && needsRebase) {
    title = "Update available";
  } else {
    title = "Ready to merge";
  }

  const content = (
    <div className={styles.card}>
      <div className={styles.row}>
        <div className={styles.iconWrap} data-tone={tone}>
          <Icons.MergeIcon size={14} />
        </div>
        <div className={styles.body}>
          <div className={styles.title}>
            {title}
            {baseBranch && !hasConflicts && !hasRebaseError && !justMerged && hasWork && (
              <span className={styles.target}>
                {" into "}
                <span className={styles.branch}>{baseBranch}</span>
              </span>
            )}
          </div>
          <div className={styles.meta}>
            <span>{statusLine}</span>
            {diffStats && diffStats.files > 0 && !justMerged && (
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
          {justMerged ? (
            <button
              className={styles.deleteBtn}
              disabled={isDeleting}
              title="Delete this session and its branch"
              type="button"
              onClick={handleDelete}
            >
              <Icons.TrashIcon size={11} />
              {isDeleting ? "Deleting\u2026" : "Delete session"}
            </button>
          ) : (
            <>
              <button
                className={styles.secondaryBtn}
                type="button"
                onClick={handleReview}
              >
                Review
              </button>
              {baseBranch && hasConflicts && (
                <button
                  className={styles.conflictBtn}
                  disabled={isDispatchingAgent}
                  title={
                    isDispatchingAgent
                      ? "Starting agent\u2026"
                      : `Start an agent to resolve ${conflicts.length} conflict${conflicts.length === 1 ? "" : "s"} with ${baseBranch}`
                  }
                  type="button"
                  onClick={handleFixConflictsInChat}
                >
                  <Icons.AgentStartIcon size={11} />
                  {isDispatchingAgent
                    ? "Starting\u2026"
                    : `Fix ${conflicts.length} conflict${conflicts.length === 1 ? "" : "s"} in chat`}
                </button>
              )}
              {baseBranch && !hasConflicts && needsRebase && (
                <button
                  className={styles.rebaseBtn}
                  disabled={isRebasing}
                  title={
                    hasWork
                      ? `Rebase ${sessionBranch ?? "this branch"} onto ${baseBranch}`
                      : `Update ${sessionBranch ?? "this branch"} from ${baseBranch}`
                  }
                  type="button"
                  onClick={handleRebase}
                >
                  <Icons.BranchIcon size={11} />
                  {getRebaseLabel(isRebasing, hasWork, baseBranch)}
                </button>
              )}
              {baseBranch && !hasConflicts && hasWork && (
                <button
                  className={styles.mergeBtn}
                  disabled={!canMerge}
                  title={`Merge into ${baseBranch}`}
                  type="button"
                  onClick={handleMerge}
                >
                  <Icons.MergeIcon size={11} />
                  {isMerging ? "Merging\u2026" : "Merge"}
                </button>
              )}
            </>
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
