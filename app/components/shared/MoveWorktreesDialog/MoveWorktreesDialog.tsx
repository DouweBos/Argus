import type {
  MoveWorktreesPlan,
  MoveWorktreesResult,
} from "../../../lib/types";
import { useEffect, useState } from "react";
import {
  Banner,
  Button,
  Dialog,
  DialogBody,
  DialogFooter,
  Spinner,
} from "@argus/peacock";
import { moveWorktrees, planWorktreesMove } from "../../../lib/ipc";
import styles from "./MoveWorktreesDialog.module.css";

interface MoveWorktreesDialogProps {
  onClose: () => void;
  onMoved?: () => void;
  repoRoot: string;
  toBaseDir: string;
}

type Phase = "confirm" | "done" | "loading" | "moving";

/**
 * Offered after the worktree location changes. Moving is optional — leaving
 * the existing worktrees where they are is a perfectly good answer, and they
 * keep working from the old location either way.
 */
export function MoveWorktreesDialog({
  repoRoot,
  toBaseDir,
  onClose,
  onMoved,
}: MoveWorktreesDialogProps) {
  const [phase, setPhase] = useState<Phase>("loading");
  const [plan, setPlan] = useState<MoveWorktreesPlan | null>(null);
  const [result, setResult] = useState<MoveWorktreesResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    planWorktreesMove({ repoRoot, toBaseDir })
      .then((next) => {
        setPlan(next);
        setPhase("confirm");
      })
      .catch((e: unknown) => {
        setError(e instanceof Error ? e.message : String(e));
        setPhase("confirm");
      });
  }, [repoRoot, toBaseDir]);

  const start = () => {
    setPhase("moving");
    moveWorktrees({ repoRoot, toBaseDir })
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
      title="Move existing worktrees?"
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
                ? `Argus can move this project's ${count} worktree${count === 1 ? "" : "s"} to the new location, or leave them where they are and use it for new sessions only.`
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
          <p className={styles.body}>
            <Spinner /> Moving {count} worktree{count === 1 ? "" : "s"}…
          </p>
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
