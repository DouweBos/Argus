import { useEffect, useId, useState } from "react";
import { Button } from "../Button/Button";
import { Dialog } from "../Dialog/Dialog";
import { Input } from "../Input/Input";
import styles from "./BranchDialog.module.css";

export interface BranchDialogResult {
  name: string;
  startPoint: string;
  switchTo: boolean;
}

export interface BranchDialogProps {
  open: boolean;
  /** Display name of the current HEAD — used as the default start-point label. */
  currentBranch: string;
  /**
   * Optional list of branch names the user can pick as the start point.
   * If omitted, the start-point picker collapses to a free-text input.
   */
  branchOptions?: string[];
  /** Optional initial branch name (e.g. `feature/`). */
  defaultName?: string;
  /** Optional initial start-point. Defaults to the current branch. */
  defaultStartPoint?: string;
  /** Optional initial switch-to-branch toggle. */
  defaultSwitchTo?: boolean;
  /** Inline validation message shown below the name field. */
  validationError?: string;
  onConfirm: (result: BranchDialogResult) => void;
  onCancel: () => void;
}

/**
 * "New branch" dialog. Captures branch name + start point + an optional
 * "switch to branch after create" toggle.
 */
export function BranchDialog({
  open,
  currentBranch,
  branchOptions,
  defaultName = "",
  defaultStartPoint,
  defaultSwitchTo = true,
  validationError,
  onConfirm,
  onCancel,
}: BranchDialogProps) {
  const titleId = useId();
  const nameId = useId();
  const startId = useId();
  const switchId = useId();

  const [name, setName] = useState(defaultName);
  const [startPoint, setStartPoint] = useState(
    defaultStartPoint ?? currentBranch,
  );
  const [switchTo, setSwitchTo] = useState(defaultSwitchTo);

  useEffect(() => {
    if (open) {
      setName(defaultName);
      setStartPoint(defaultStartPoint ?? currentBranch);
      setSwitchTo(defaultSwitchTo);
    }
  }, [open, defaultName, defaultStartPoint, defaultSwitchTo, currentBranch]);

  if (!open) {
    return null;
  }

  const submit = () => {
    if (!name.trim()) {
      return;
    }
    onConfirm({ name: name.trim(), startPoint, switchTo });
  };

  return (
    <Dialog onClose={onCancel} title="New branch" titleId={titleId}>
      <div className={styles.body}>
        <label className={styles.label} htmlFor={nameId}>
          Branch name
        </label>
        <Input
          autoFocus
          id={nameId}
          placeholder="feature/awesome-thing"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              submit();
            }
          }}
        />
        {validationError && (
          <div className={styles.error}>{validationError}</div>
        )}

        <label className={styles.label} htmlFor={startId}>
          Branch from
        </label>
        {branchOptions && branchOptions.length > 0 ? (
          <select
            id={startId}
            className={styles.select}
            value={startPoint}
            onChange={(e) => setStartPoint(e.target.value)}
          >
            {branchOptions.map((b) => (
              <option key={b} value={b}>
                {b}
                {b === currentBranch ? " (current)" : ""}
              </option>
            ))}
          </select>
        ) : (
          <Input
            id={startId}
            value={startPoint}
            onChange={(e) => setStartPoint(e.target.value)}
          />
        )}

        <label className={styles.checkRow} htmlFor={switchId}>
          <input
            id={switchId}
            type="checkbox"
            className={styles.checkbox}
            checked={switchTo}
            onChange={(e) => setSwitchTo(e.target.checked)}
          />
          <span>Switch to branch after create</span>
        </label>
      </div>
      <div className={styles.footer}>
        <Button variant="secondary" onClick={onCancel}>
          Cancel
        </Button>
        <Button variant="primary" onClick={submit} disabled={!name.trim()}>
          Create branch
        </Button>
      </div>
    </Dialog>
  );
}
