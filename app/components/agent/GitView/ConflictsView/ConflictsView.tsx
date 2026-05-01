import { useCallback, useState } from "react";
import {
  Button,
  DestructiveConfirm,
  GitErrorBanner,
  Icons,
  type GitErrorKind,
  type GitInProgressInfo,
} from "@argus/peacock";
import { useDiffFiles } from "../../../../hooks/useDiffFiles";
import { GitError } from "../../../../lib/gitError";
import {
  gitAbortCherryPick,
  gitAbortMerge,
  gitAbortRebase,
  gitContinueCherryPick,
  gitContinueMerge,
  gitContinueRebase,
  gitMarkResolved,
  gitSkipRebase,
} from "../../../../lib/ipc";
import {
  getConfirmPreference,
  setConfirmPreference,
} from "../../../../stores/settingsStore";
import styles from "./ConflictsView.module.css";
import { ThreeWayMergeEditor } from "./ThreeWayMergeEditor";

const OP_LABELS: Record<GitInProgressInfo["kind"], string> = {
  merge: "Merge",
  rebase: "Rebase",
  "cherry-pick": "Cherry-pick",
  bisect: "Bisect",
};

interface ConflictsViewProps {
  baseBranch?: string | null;
  /** Op currently in progress; falsy means there's nothing to show. */
  inProgress: GitInProgressInfo | null;
  sessionId: string;
}

interface BannerState {
  kind: GitErrorKind;
  message: string;
  recovery?: string;
}

function rememberKeyForAbort(kind: GitInProgressInfo["kind"]): string {
  return `abort-${kind}`;
}

/**
 * Conflict resolution view (Phase 2 W9). Lists conflicted files, opens an
 * inline three-way merge editor on selection, and exposes Continue / Abort /
 * Skip buttons keyed off the in-progress op kind.
 */
export function ConflictsView({
  inProgress,
  sessionId,
  baseBranch,
}: ConflictsViewProps) {
  const { conflictFiles } = useDiffFiles(sessionId, {
    baseBranch: baseBranch ?? undefined,
  });
  const [banner, setBanner] = useState<BannerState | null>(null);
  const [busy, setBusy] = useState(false);
  const [abortConfirmOpen, setAbortConfirmOpen] = useState(false);
  const [openFile, setOpenFile] = useState<string | null>(null);

  const op = inProgress;
  const opLabel = op ? OP_LABELS[op.kind] : "Operation";

  const reportError = useCallback((err: unknown) => {
    if (err instanceof GitError) {
      setBanner({
        kind: err.kind,
        message: err.message,
        recovery: err.recovery,
      });
    } else {
      setBanner({
        kind: "unknown",
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }, []);

  const runOp = useCallback(
    async (fn: () => Promise<void>) => {
      setBusy(true);
      setBanner(null);
      try {
        await fn();
      } catch (err) {
        reportError(err);
      } finally {
        setBusy(false);
      }
    },
    [reportError],
  );

  const handleContinue = useCallback(() => {
    if (!op) {
      return;
    }
    if (op.kind === "merge") {
      runOp(() => gitContinueMerge(sessionId));
    } else if (op.kind === "rebase") {
      runOp(() => gitContinueRebase(sessionId));
    } else if (op.kind === "cherry-pick") {
      runOp(() => gitContinueCherryPick(sessionId));
    }
  }, [op, runOp, sessionId]);

  const handleAbortRequest = useCallback(() => {
    if (!op) {
      return;
    }
    const skip = getConfirmPreference(rememberKeyForAbort(op.kind));
    if (skip) {
      doAbort();

      return;
    }
    setAbortConfirmOpen(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [op]);

  const doAbort = useCallback(
    (skipNextTime?: boolean) => {
      if (!op) {
        return;
      }
      if (skipNextTime) {
        setConfirmPreference(rememberKeyForAbort(op.kind), true);
      }
      setAbortConfirmOpen(false);
      if (op.kind === "merge") {
        runOp(() => gitAbortMerge(sessionId));
      } else if (op.kind === "rebase") {
        runOp(() => gitAbortRebase(sessionId));
      } else if (op.kind === "cherry-pick") {
        runOp(() => gitAbortCherryPick(sessionId));
      }
    },
    [op, runOp, sessionId],
  );

  const handleSkip = useCallback(() => {
    if (op?.kind !== "rebase") {
      return;
    }
    runOp(() => gitSkipRebase(sessionId));
  }, [op, runOp, sessionId]);

  const handleMarkResolved = useCallback(
    async (path: string) => {
      try {
        await gitMarkResolved(sessionId, path);
        setOpenFile(null);
      } catch (err) {
        reportError(err);
      }
    },
    [sessionId, reportError],
  );

  const allResolved = op != null && conflictFiles.length === 0;
  let continueLabel = "Continue merge";
  if (op?.kind === "rebase") {
    continueLabel = "Continue rebase";
  } else if (op?.kind === "cherry-pick") {
    continueLabel = "Continue cherry-pick";
  }

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <div className={styles.title}>
          <Icons.MergeIcon size={14} />
          <span>{opLabel} in progress</span>
        </div>
        {op && (
          <div className={styles.subtitle}>
            {op.head}
            {op.onto ? ` ← ${op.onto}` : ""}
          </div>
        )}
        <div className={styles.actions}>
          <Button
            size="sm"
            variant="primary"
            disabled={busy || !op}
            onClick={handleContinue}
          >
            {continueLabel}
          </Button>
          <Button
            size="sm"
            variant="danger"
            disabled={busy || !op}
            onClick={handleAbortRequest}
          >
            Abort
          </Button>
          {op?.kind === "rebase" && (
            <Button
              size="sm"
              variant="secondary"
              disabled={busy}
              onClick={handleSkip}
            >
              Skip
            </Button>
          )}
        </div>
      </div>

      {allResolved && (
        <div className={styles.allResolved}>
          All conflicts resolved. Click {continueLabel} to finish.
        </div>
      )}

      {banner && (
        <GitErrorBanner
          kind={banner.kind}
          message={banner.message}
          recovery={banner.recovery}
          onDismiss={() => setBanner(null)}
          onAction={(actionId) => {
            if (actionId === "copy-stderr") {
              navigator.clipboard
                ?.writeText(banner.message)
                .catch(() => undefined);
            }
            setBanner(null);
          }}
        />
      )}

      <div className={styles.list}>
        {conflictFiles.length === 0 ? (
          <div className={styles.empty}>
            No conflicted files reported. The operation may still need a
            Continue or Abort.
          </div>
        ) : (
          conflictFiles.map((path) => (
            <button
              key={path}
              type="button"
              className={styles.row}
              onClick={() => setOpenFile(path)}
            >
              <span className={styles.rowBadge}>U</span>
              <span className={styles.rowPath}>{path}</span>
            </button>
          ))
        )}
      </div>

      {openFile && (
        <ThreeWayMergeEditor
          filePath={openFile}
          sessionId={sessionId}
          onClose={() => setOpenFile(null)}
          onMarkResolved={() => handleMarkResolved(openFile)}
        />
      )}

      {op && (
        <DestructiveConfirm
          open={abortConfirmOpen}
          title={`Abort ${opLabel.toLowerCase()}?`}
          tone="destructive"
          description={
            <>
              This will discard the in-progress {opLabel.toLowerCase()} and
              restore the worktree to the state before it started. Any
              resolved-but-uncommitted work will be lost.
            </>
          }
          confirmLabel={`Abort ${opLabel.toLowerCase()}`}
          rememberKey={rememberKeyForAbort(op.kind)}
          rememberLabel={`abort ${op.kind}`}
          onConfirm={(skip) => doAbort(skip)}
          onCancel={() => setAbortConfirmOpen(false)}
        />
      )}
    </div>
  );
}
