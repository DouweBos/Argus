import type {
  MoveWorktreesPlan,
  MoveWorktreesProgress,
  MoveWorktreesResult,
  WorktreePurpose,
} from "../../../lib/types";
import { useEffect, useState } from "react";
import {
  Banner,
  Button,
  Dialog,
  DialogBody,
  DialogFooter,
  ProgressBar,
  Spinner,
} from "@argus/peacock";
import { useIpcEvent } from "../../../hooks/useIpcEvent";
import { moveWorktrees, planWorktreesMove } from "../../../lib/ipc";
import styles from "./MoveWorktreesDialog.module.css";

interface MoveWorktreesDialogProps {
  onClose: () => void;
  onMoved?: () => void;
  /** Which set of worktrees is being relocated. Defaults to the user's own. */
  purpose?: WorktreePurpose;
  repoRoot: string;
  toBaseDir: string;
}

type Phase = "confirm" | "done" | "loading" | "moving";

/** Overall fraction: finished worktrees plus how far into the current one. */
function overallProgress(p: MoveWorktreesProgress): number {
  let current = 0;
  if (p.step === "removing") {
    current = 1;
  } else if (p.step === "copying" && p.total_entries > 0) {
    current = p.done_entries / p.total_entries;
  }

  return (p.index + current) / p.total;
}

function stepLabel(p: MoveWorktreesProgress): string {
  switch (p.step) {
    case "moving":
      return "Moving…";
    case "counting":
      return "Counting files…";
    case "copying":
      return p.total_entries > 0
        ? `Copying ${p.done_entries.toLocaleString()} of ${p.total_entries.toLocaleString()} files`
        : "Copying…";
    case "removing":
      return "Removing the old copy…";
  }
}

/**
 * Offered before a new worktree location is committed. Moving is optional —
 * leaving the existing worktrees where they are is a perfectly good answer,
 * and they keep working from the old location either way.
 */
export function MoveWorktreesDialog({
  purpose = "user",
  repoRoot,
  toBaseDir,
  onClose,
  onMoved,
}: MoveWorktreesDialogProps) {
  const [phase, setPhase] = useState<Phase>("loading");
  const [plan, setPlan] = useState<MoveWorktreesPlan | null>(null);
  const [result, setResult] = useState<MoveWorktreesResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<MoveWorktreesProgress | null>(null);

  useIpcEvent<MoveWorktreesProgress>(
    "session:worktrees-move-progress",
    (next) => {
      if (next.repo_root === repoRoot) {
        setProgress(next);
      }
    },
  );

  useEffect(() => {
    planWorktreesMove({ purpose, repoRoot, toBaseDir })
      .then((next) => {
        setPlan(next);
        setPhase("confirm");
      })
      .catch((e: unknown) => {
        setError(e instanceof Error ? e.message : String(e));
        setPhase("confirm");
      });
  }, [purpose, repoRoot, toBaseDir]);

  const start = () => {
    setPhase("moving");
    setProgress(null);
    moveWorktrees({ purpose, repoRoot, toBaseDir })
      .then((next) => {
        setResult(next);
        setPhase("done");
        onMoved?.();
      })
      .catch((e: unknown) => {
        setError(e instanceof Error ? e.message : String(e));
        setPhase("confirm");
      });
  };

  const count = plan?.sessions.length ?? 0;
  const blockers = plan?.blockers ?? [];

  return (
    <Dialog
      title={
        purpose === "automation"
          ? "Move existing automation worktrees?"
          : "Move existing worktrees?"
      }
      titleId="move-worktrees-title"
      size="medium"
      // Interrupting a move mid-copy is how you end up with two half trees.
      onClose={phase === "moving" ? () => undefined : onClose}
    >
      <DialogBody>
        {error != null && <Banner tone="error">{error}</Banner>}

        {phase === "loading" && <Spinner />}

        {phase === "confirm" && (
          <>
            <p className={styles.body}>
              {count > 0
                ? `Argus can move ${count} ${purpose === "automation" ? "automation " : ""}worktree${count === 1 ? "" : "s"} to the new location, or leave them where they are and use it for new sessions only.`
                : "There are no worktrees to move. New sessions will use the new location."}
            </p>
            <p className={styles.path}>{plan?.to_root}</p>
            {blockers.length > 0 && (
              <Banner tone="warning">
                These will be stopped first:{" "}
                {blockers
                  .map((b) => `${b.session_label} (${b.detail})`)
                  .join(", ")}
                . They are skipped by this move.
              </Banner>
            )}
          </>
        )}

        {phase === "moving" && (
          <div className={styles.progress}>
            <p className={styles.body}>
              {progress
                ? `Moving ${progress.index + 1} of ${progress.total}: `
                : `Moving ${count} worktree${count === 1 ? "" : "s"}…`}
              {progress && (
                <span className={styles.branch}>{progress.branch}</span>
              )}
            </p>
            <ProgressBar
              aria-label="Worktree move progress"
              indeterminate={progress == null}
              progress={progress ? overallProgress(progress) : 0}
              size="md"
            />
            {progress && <p className={styles.step}>{stepLabel(progress)}</p>}
          </div>
        )}

        {phase === "done" && result != null && (
          <>
            <p className={styles.body}>
              Moved {result.moved.length} of {count}.
            </p>
            {result.failed.length > 0 && (
              <Banner tone="error">
                {result.failed.length} couldn&apos;t be moved and are still at
                the old location, where they keep working. Try again once
                whatever is holding them has stopped.
              </Banner>
            )}
          </>
        )}
      </DialogBody>

      <DialogFooter>
        {phase === "confirm" && (
          <>
            <Button variant="ghost" onClick={onClose}>
              Leave them
            </Button>
            <Button variant="primary" disabled={count === 0} onClick={start}>
              Move {count} worktree{count === 1 ? "" : "s"}
            </Button>
          </>
        )}
        {phase === "moving" && (
          <Button variant="primary" disabled>
            Moving…
          </Button>
        )}
        {phase === "done" && (
          <Button variant="primary" onClick={onClose}>
            Done
          </Button>
        )}
      </DialogFooter>
    </Dialog>
  );
}
