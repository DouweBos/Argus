import { useState } from "react";
import { Button } from "@argus/peacock";
import styles from "./StashesView.module.css";

interface StashRowActionsProps {
  busy: boolean;
  onApply: () => void;
  onCreateBranch: (branchName: string) => void;
  onDrop: () => void;
  onPop: () => void;
}

/**
 * Detail-pane action toolbar for a stash entry. Splits out of `StashesView`
 * to keep the parent component under the 300-line cap and to localise the
 * inline "create branch" prompt state.
 */
export function StashRowActions({
  busy,
  onApply,
  onPop,
  onDrop,
  onCreateBranch,
}: StashRowActionsProps) {
  const [branchInputOpen, setBranchInputOpen] = useState(false);
  const [branchName, setBranchName] = useState("");

  const submitBranch = () => {
    const trimmed = branchName.trim();
    if (!trimmed) {
      return;
    }
    onCreateBranch(trimmed);
    setBranchInputOpen(false);
    setBranchName("");
  };

  return (
    <div className={styles.actionsWrap}>
      <div className={styles.detailActions}>
        <Button size="sm" variant="primary" disabled={busy} onClick={onApply}>
          Apply
        </Button>
        <Button size="sm" variant="secondary" disabled={busy} onClick={onPop}>
          Pop
        </Button>
        <Button
          size="sm"
          variant="ghost"
          disabled={busy}
          onClick={() => setBranchInputOpen((v) => !v)}
        >
          Create Branch
        </Button>
        <Button size="sm" variant="danger" disabled={busy} onClick={onDrop}>
          Delete
        </Button>
      </div>
      {branchInputOpen && (
        <div className={styles.branchPromptRow}>
          <input
            autoFocus
            className={styles.branchInput}
            placeholder="new-branch-name"
            value={branchName}
            onChange={(e) => setBranchName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                submitBranch();
              } else if (e.key === "Escape") {
                setBranchInputOpen(false);
                setBranchName("");
              }
            }}
          />
          <Button
            size="sm"
            variant="primary"
            disabled={busy || branchName.trim().length === 0}
            onClick={submitBranch}
          >
            Create
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              setBranchInputOpen(false);
              setBranchName("");
            }}
          >
            Cancel
          </Button>
        </div>
      )}
    </div>
  );
}
