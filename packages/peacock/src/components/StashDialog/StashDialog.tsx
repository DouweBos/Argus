import { useEffect, useId, useState } from "react";
import { Button } from "../Button/Button";
import { Dialog } from "../Dialog/Dialog";
import { DialogBody } from "../Dialog/DialogBody";
import { DialogFooter } from "../Dialog/DialogFooter";
import { Input } from "../Input/Input";
import styles from "./StashDialog.module.css";

export interface StashDialogResult {
  includeUntracked: boolean;
  keepIndex: boolean;
  message: string;
}

export interface StashDialogProps {
  open: boolean;
  onConfirm: (options: StashDialogResult) => void;
  onCancel: () => void;
  defaultMessage?: string;
  /** Optional initial values for the option toggles. */
  defaultIncludeUntracked?: boolean;
  defaultKeepIndex?: boolean;
}

/**
 * Modal dialog for `git stash push` with options. Captures an optional
 * message plus toggles for `--include-untracked` and `--keep-index`.
 */
export function StashDialog({
  open,
  onConfirm,
  onCancel,
  defaultMessage = "",
  defaultIncludeUntracked = false,
  defaultKeepIndex = false,
}: StashDialogProps) {
  const titleId = useId();
  const messageId = useId();
  const includeId = useId();
  const keepId = useId();

  const [message, setMessage] = useState(defaultMessage);
  const [includeUntracked, setIncludeUntracked] = useState(
    defaultIncludeUntracked,
  );
  const [keepIndex, setKeepIndex] = useState(defaultKeepIndex);

  // Reset form whenever the dialog opens so consumers don't have to remount.
  useEffect(() => {
    if (open) {
      setMessage(defaultMessage);
      setIncludeUntracked(defaultIncludeUntracked);
      setKeepIndex(defaultKeepIndex);
    }
  }, [open, defaultMessage, defaultIncludeUntracked, defaultKeepIndex]);

  if (!open) {
    return null;
  }

  const handleConfirm = () => {
    onConfirm({ message: message.trim(), includeUntracked, keepIndex });
  };

  return (
    <Dialog onClose={onCancel} title="Stash changes" titleId={titleId}>
      <DialogBody className={styles.body}>
        <label className={styles.fieldLabel} htmlFor={messageId}>
          Message
        </label>
        <Input
          autoFocus
          id={messageId}
          placeholder="WIP on branch …"
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              handleConfirm();
            }
          }}
        />
        <label className={styles.checkRow} htmlFor={includeId}>
          <input
            id={includeId}
            type="checkbox"
            className={styles.checkbox}
            checked={includeUntracked}
            onChange={(e) => setIncludeUntracked(e.target.checked)}
          />
          <span>Include untracked files</span>
        </label>
        <label className={styles.checkRow} htmlFor={keepId}>
          <input
            id={keepId}
            type="checkbox"
            className={styles.checkbox}
            checked={keepIndex}
            onChange={(e) => setKeepIndex(e.target.checked)}
          />
          <span>Keep index (leave staged changes in place)</span>
        </label>
      </DialogBody>
      <DialogFooter>
        <Button variant="secondary" onClick={onCancel}>
          Cancel
        </Button>
        <Button variant="primary" onClick={handleConfirm}>
          Stash
        </Button>
      </DialogFooter>
    </Dialog>
  );
}
