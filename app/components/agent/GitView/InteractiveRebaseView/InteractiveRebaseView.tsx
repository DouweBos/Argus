/**
 * Phase 12 — Interactive rebase view.
 *
 * Route: /sessions/:id/git/interactive-rebase?from=<upstream-ref>
 *
 * Loads the commit range between `fromRef` and HEAD, renders the Peacock
 * `RebaseEditor` primitive, and drives the git_rebase_interactive_run IPC.
 * Conflicts mid-rebase surface via the existing `ConflictsView` —
 * `useGitObservation` detects `.git/rebase-merge` and the parent `GitView`
 * auto-routes to the conflicts view.
 */

import { useCallback, useEffect, useState } from "react";
import {
  GitErrorBanner,
  GitSkeleton,
  RebaseEditor,
  type GitErrorKind,
  type RebasePlanEntry,
} from "@argus/peacock";
import { useGitObservation } from "../../../../hooks/useGitObservation";
import { GitError } from "../../../../lib/gitError";
import {
  gitAbortRebase,
  gitContinueRebase,
  gitRebaseInteractivePlan,
  gitRebaseInteractiveRun,
  type RebasePlanCommit,
} from "../../../../lib/ipc";
import styles from "./InteractiveRebaseView.module.css";

interface InteractiveRebaseViewProps {
  fromRef: string;
  onDone: () => void;
  sessionId: string;
}

interface BannerState {
  kind: GitErrorKind;
  message: string;
}

export function InteractiveRebaseView({
  fromRef,
  sessionId,
  onDone,
}: InteractiveRebaseViewProps) {
  const [commits, setCommits] = useState<RebasePlanCommit[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [banner, setBanner] = useState<BannerState | null>(null);

  const { status } = useGitObservation(sessionId);

  // Determine whether a rebase is currently paused mid-way (e.g. an "edit"
  // stop or after the user resolved conflicts and returned to this view).
  const isPaused = status?.inProgress?.kind === "rebase";

  useEffect(() => {
    if (!fromRef) {
      return;
    }
    /* eslint-disable react-hooks/set-state-in-effect --
       Async data fetch — established Argus pattern. */
    setLoading(true);
    setBanner(null);
    /* eslint-enable react-hooks/set-state-in-effect */
    gitRebaseInteractivePlan(sessionId, { upstream: fromRef })
      .then((plan) => {
        setCommits(plan);
        setLoading(false);
      })
      .catch((err: unknown) => {
        setLoading(false);
        if (err instanceof GitError) {
          setBanner({ kind: err.kind, message: err.message });
        } else {
          setBanner({
            kind: "unknown",
            message: err instanceof Error ? err.message : String(err),
          });
        }
      });
  }, [sessionId, fromRef]);

  const handleConfirm = useCallback(
    async (rawPlan: RebasePlanEntry[]) => {
      setBusy(true);
      setBanner(null);
      try {
        await gitRebaseInteractiveRun(sessionId, {
          upstream: fromRef,
          plan: rawPlan,
        });
        onDone();
      } catch (err) {
        setBusy(false);
        if (err instanceof GitError) {
          setBanner({ kind: err.kind, message: err.message });
        } else {
          setBanner({
            kind: "unknown",
            message: err instanceof Error ? err.message : String(err),
          });
        }
        // If the rebase left the repo in a mid-rebase state (conflict), the
        // parent GitView's useGitObservation watcher will detect `.git/rebase-merge`
        // and auto-navigate to ConflictsView. We leave that to happen naturally.
      }
    },
    [sessionId, fromRef, onDone],
  );

  const handleContinue = useCallback(async () => {
    setBusy(true);
    setBanner(null);
    try {
      await gitContinueRebase(sessionId);
      onDone();
    } catch (err) {
      setBusy(false);
      if (err instanceof GitError) {
        setBanner({ kind: err.kind, message: err.message });
      } else {
        setBanner({
          kind: "unknown",
          message: err instanceof Error ? err.message : String(err),
        });
      }
    }
  }, [sessionId, onDone]);

  const handleAbort = useCallback(async () => {
    setBusy(true);
    setBanner(null);
    try {
      await gitAbortRebase(sessionId);
      onDone();
    } catch (err) {
      setBusy(false);
      if (err instanceof GitError) {
        setBanner({ kind: err.kind, message: err.message });
      } else {
        setBanner({
          kind: "unknown",
          message: err instanceof Error ? err.message : String(err),
        });
      }
    }
  }, [sessionId, onDone]);

  if (loading) {
    return (
      <div className={styles.container}>
        <GitSkeleton variant="commit-log" />
      </div>
    );
  }

  return (
    <div className={styles.container}>
      {banner && (
        <GitErrorBanner
          kind={banner.kind}
          message={banner.message}
          onAction={(actionId) => {
            if (actionId === "copy-stderr") {
              navigator.clipboard
                ?.writeText(banner.message)
                .catch(() => undefined);
            }
            setBanner(null);
          }}
          onDismiss={() => setBanner(null)}
        />
      )}

      <RebaseEditor
        open
        baseRef={fromRef}
        commits={commits.map((c) => ({
          hash: c.hash,
          subject: c.subject,
          author: c.author,
        }))}
        pausedAt={isPaused ? (status?.inProgress?.head ?? null) : null}
        onCancel={onDone}
        onConfirm={(plan: RebasePlanEntry[]) => {
          if (!busy) {
            handleConfirm(plan).catch(() => undefined);
          }
        }}
        onContinue={
          isPaused
            ? () => {
                handleContinue().catch(() => undefined);
              }
            : undefined
        }
        onAbort={
          isPaused
            ? () => {
                handleAbort().catch(() => undefined);
              }
            : undefined
        }
      />
    </div>
  );
}
