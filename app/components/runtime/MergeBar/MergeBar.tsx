import type { SessionMergeStrategy } from "../../../lib/ipc";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Button, Icons } from "@argus/peacock";
import { useArgusConfigVersion } from "../../../hooks/useArgusConfigVersion";
import { useIpcEvent } from "../../../hooks/useIpcEvent";
import {
  getSessionCommitsAhead,
  getSessionConflicts,
  getSessionMergeBlockers,
  getSessionStagedDiff,
  mergeSessionIntoBase,
  readArgusConfig,
} from "../../../lib/ipc";
import { useSessions } from "../../../stores/sessionStore";
import { CreatePullRequestDialog } from "../../pullRequests/CreatePullRequestDialog";
import { MergeStrategyDialog } from "../../shared/MergeStrategyDialog";
import styles from "./MergeBar.module.css";

interface MergeBarProps {
  sessionId: string | null;
}

export function MergeBar({ sessionId }: MergeBarProps) {
  const sessions = useSessions();
  const session = useMemo(
    () =>
      sessionId ? (sessions.find((w) => w.id === sessionId) ?? null) : null,
    [sessionId, sessions],
  );

  const configVersion = useArgusConfigVersion(session?.repo_root ?? null);
  const [conflicts, setConflicts] = useState<string[]>([]);
  const [blockers, setBlockers] = useState<string[]>([]);
  const [hasStaged, setHasStaged] = useState(false);
  const [commitsAhead, setCommitsAhead] = useState(0);
  const [isMerging, setIsMerging] = useState(false);
  const [mergeError, setMergeError] = useState<string | null>(null);
  const [isProtectedBase, setIsProtectedBase] = useState(false);
  const [createPrOpen, setCreatePrOpen] = useState(false);
  const [askingStrategy, setAskingStrategy] = useState(false);

  const fetchStatus = useCallback(async () => {
    if (!sessionId) {
      return;
    }
    try {
      const [conflictResult, blockerResult, stagedDiff, ahead] =
        await Promise.all([
          getSessionConflicts(sessionId),
          getSessionMergeBlockers(sessionId),
          getSessionStagedDiff(sessionId),
          getSessionCommitsAhead(sessionId),
        ]);
      setConflicts(conflictResult);
      setBlockers(blockerResult);
      setHasStaged(stagedDiff.trim() !== "");
      setCommitsAhead(ahead);
    } catch {
      // ignore
    }
  }, [sessionId]);

  useEffect(() => {
    fetchStatus();
  }, [fetchStatus]);

  // Watch whether the session's base branch is listed as protected in
  // `.argus.json`. Protected branches can't be merged into from the app —
  // the UI flips to a "Push & open PR" flow instead.
  useEffect(() => {
    if (!session?.repo_root || !session.base_branch) {
      setIsProtectedBase(false);

      return;
    }
    let cancelled = false;
    readArgusConfig(session.repo_root)
      .then((config) => {
        if (cancelled) {
          return;
        }
        const protectedList = config.protected_branches ?? [];
        setIsProtectedBase(
          session.base_branch
            ? protectedList.includes(session.base_branch)
            : false,
        );
      })
      .catch(() => {
        if (!cancelled) {
          setIsProtectedBase(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [session?.repo_root, session?.base_branch, configVersion]);

  useIpcEvent(
    sessionId ? `session:diff-changed:${sessionId}` : "",
    fetchStatus,
  );

  const handleMerge = useCallback(
    async (strategy: SessionMergeStrategy) => {
      if (!sessionId) {
        return;
      }
      setAskingStrategy(false);
      setIsMerging(true);
      setMergeError(null);
      try {
        await mergeSessionIntoBase(sessionId, strategy);
      } catch (err) {
        setMergeError(err instanceof Error ? err.message : String(err));
      } finally {
        setIsMerging(false);
      }
    },
    [sessionId],
  );

  if (!session || session.kind !== "worktree" || !session.base_branch) {
    return null;
  }

  const hasConflicts = conflicts.length > 0;
  const hasBlockers = blockers.length > 0;
  const hasMergeableWork = hasStaged || commitsAhead > 0;
  const canMerge =
    hasMergeableWork && !hasConflicts && !hasBlockers && !isMerging;

  if (isProtectedBase) {
    const canOpenPr = hasMergeableWork;
    const pushBtnTitle = hasMergeableWork
      ? `Push ${session.branch} and open a pull request against ${session.base_branch}`
      : `Stage or commit changes in this session, then open a pull request`;
    const statusLabel = hasMergeableWork
      ? `${session.base_branch} is protected — open a PR`
      : `Stage changes to open a PR into ${session.base_branch}`;
    const toneClass = hasMergeableWork ? styles.barReady : styles.barNoStaged;
    const textToneClass = hasMergeableWork
      ? styles.statusTextReady
      : styles.statusTextNoStaged;

    return (
      <>
        {createPrOpen && (
          <CreatePullRequestDialog
            sessionId={session.id}
            repoRoot={session.repo_root}
            headBranch={session.branch}
            baseBranch={session.base_branch}
            onClose={() => setCreatePrOpen(false)}
          />
        )}
        <div className={`${styles.bar} ${toneClass}`}>
          <span className={`${styles.statusText} ${textToneClass}`}>
            {statusLabel}
          </span>
          <Button
            disabled={!canOpenPr}
            leading={<Icons.PushIcon size={11} />}
            size="sm"
            variant="primary"
            title={pushBtnTitle}
            onClick={() => setCreatePrOpen(true)}
          >
            Open PR
          </Button>
        </div>
        {mergeError && <div className={styles.error}>{mergeError}</div>}
      </>
    );
  }

  let mergeBtnTitle: string;
  if (hasConflicts) {
    mergeBtnTitle = `${conflicts.length} conflict${conflicts.length === 1 ? "" : "s"} — resolve before merging into ${session.base_branch}`;
  } else if (hasBlockers) {
    const preview = blockers.slice(0, 3).join(", ");
    const more = blockers.length > 3 ? ` (+${blockers.length - 3} more)` : "";
    mergeBtnTitle = `${session.base_branch} has uncommitted changes that this merge would overwrite: ${preview}${more}. Commit, stash, or discard them in the ${session.base_branch} worktree first.`;
  } else if (!hasMergeableWork) {
    mergeBtnTitle = `Stage changes in this session, then merge into ${session.base_branch}`;
  } else if (hasStaged && commitsAhead > 0) {
    mergeBtnTitle = `Commits staged changes on ${session.branch}, then merges into ${session.base_branch} (${commitsAhead} existing commit${commitsAhead === 1 ? "" : "s"} also included)`;
  } else if (hasStaged) {
    mergeBtnTitle = `Commits staged changes on ${session.branch}, then merges into ${session.base_branch}`;
  } else {
    mergeBtnTitle = `Merges ${commitsAhead} commit${commitsAhead === 1 ? "" : "s"} from ${session.branch} into ${session.base_branch}`;
  }

  let barToneClass = styles.barNoStaged;
  let statusTextToneClass = styles.statusTextNoStaged;
  let statusLabel: string;
  if (hasConflicts) {
    barToneClass = styles.barConflict;
    statusTextToneClass = styles.statusTextConflict;
    statusLabel = `${conflicts.length} conflict${conflicts.length > 1 ? "s" : ""}`;
  } else if (hasBlockers) {
    barToneClass = styles.barConflict;
    statusTextToneClass = styles.statusTextConflict;
    statusLabel = `${session.base_branch} has uncommitted changes to ${blockers.length} file${blockers.length === 1 ? "" : "s"} this merge would overwrite`;
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
      {askingStrategy && session.base_branch && (
        <MergeStrategyDialog
          baseBranch={session.base_branch}
          commitsAhead={commitsAhead}
          sessionBranch={session.branch}
          onCancel={() => setAskingStrategy(false)}
          onChoose={handleMerge}
        />
      )}
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
          onClick={() => setAskingStrategy(true)}
        >
          {isMerging ? "Merging..." : "Merge"}
        </Button>
      </div>
      {mergeError && <div className={styles.error}>{mergeError}</div>}
    </>
  );
}
