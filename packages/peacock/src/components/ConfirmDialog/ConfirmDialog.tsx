import type { ReactNode } from "react";
import { useState } from "react";
import { Button } from "../Button/Button";
import { Dialog } from "../Dialog/Dialog";
import { DialogBody } from "../Dialog/DialogBody";
import { DialogFooter } from "../Dialog/DialogFooter";
import styles from "./ConfirmDialog.module.css";

export interface ConfirmDialogProps {
  /** Body content — plain text or arbitrary node (e.g. list of items). */
  children: ReactNode;
  /** Label for the cancel button. */
  cancelLabel?: string;
  /** Label for the confirm button. */
  confirmLabel?: string;
  /** When true, the confirm button uses the danger variant. */
  destructive?: boolean;
  /** Called when the user dismisses via cancel, close, backdrop, or escape. */
  onCancel: () => void;
  /**
   * Called when the user accepts. If the handler returns a Promise, the
   * confirm button shows a pending state and stays disabled until it settles.
   */
  onConfirm: () => Promise<void> | void;
  /** Title shown in the dialog header. */
  title: ReactNode;
  /** Stable id for `aria-labelledby`. */
  titleId: string;
}

/**
 * Standard confirmation dialog: title, body, cancel + confirm buttons.
 * Use `destructive` for irreversible actions (stop, delete, quit).
 */
export function ConfirmDialog({
  children,
  cancelLabel = "Cancel",
  confirmLabel = "Confirm",
  destructive = false,
  onCancel,
  onConfirm,
  title,
  titleId,
}: ConfirmDialogProps) {
  const [busy, setBusy] = useState(false);

  const handleConfirm = async () => {
    if (busy) {
      return;
    }
    try {
      const result = onConfirm();
      if (result instanceof Promise) {
        setBusy(true);
        await result;
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog onClose={onCancel} title={title} titleId={titleId}>
      <DialogBody className={styles.body}>{children}</DialogBody>
      <DialogFooter>
        <Button variant="secondary" onClick={onCancel} disabled={busy}>
          {cancelLabel}
        </Button>
        <Button
          variant={destructive ? "danger" : "primary"}
          onClick={handleConfirm}
          disabled={busy}
        >
          {confirmLabel}
        </Button>
      </DialogFooter>
    </Dialog>
  );
}
