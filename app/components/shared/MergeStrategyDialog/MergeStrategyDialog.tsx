import type { SessionMergeStrategy } from "../../../lib/ipc";
import { Button, Dialog, DialogBody, DialogFooter } from "@argus/peacock";
import styles from "./MergeStrategyDialog.module.css";

interface MergeStrategyDialogProps {
  baseBranch: string;
  /** How many commits the session is ahead — squashing 1 changes nothing. */
  commitsAhead: number;
  onCancel: () => void;
  onChoose: (strategy: SessionMergeStrategy) => void;
  sessionBranch: string;
}

/**
 * Asked before every merge: a squash rewrites history the author wrote, so it
 * is never the silent default.
 */
export function MergeStrategyDialog({
  baseBranch,
  commitsAhead,
  onCancel,
  onChoose,
  sessionBranch,
}: MergeStrategyDialogProps) {
  const count = `${commitsAhead} commit${commitsAhead === 1 ? "" : "s"}`;

  return (
    <Dialog
      title={`Merge ${sessionBranch} into ${baseBranch}`}
      titleId="merge-strategy"
      onClose={onCancel}
    >
      <DialogBody>
        <p className={styles.lead}>
          {count} from {sessionBranch} will land on {baseBranch}.
        </p>
        <ul className={styles.options}>
          <li>
            <strong>Keep every commit</strong> — history lands exactly as it was
            written.
          </li>
          <li>
            <strong>Squash into one commit</strong> — the whole session becomes
            a single conventional commit.
          </li>
        </ul>
      </DialogBody>
      <DialogFooter>
        <Button variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
        <Button variant="secondary" onClick={() => onChoose("squash")}>
          Squash into one commit
        </Button>
        <Button variant="primary" onClick={() => onChoose("keep")}>
          Keep every commit
        </Button>
      </DialogFooter>
    </Dialog>
  );
}
