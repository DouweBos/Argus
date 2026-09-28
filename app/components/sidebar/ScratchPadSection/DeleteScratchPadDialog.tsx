import type { Session } from "../../../lib/types";
import { useState } from "react";
import { Button, DialogBody, DialogFooter } from "@argus/peacock";
import { Dialog, dialogStyles as styles } from "../../shared/Dialog";

interface DeleteScratchPadDialogProps {
  onClose: () => void;
  onConfirm: () => Promise<void>;
  pad: Session;
}

export function DeleteScratchPadDialog({
  pad,
  onClose,
  onConfirm,
}: DeleteScratchPadDialogProps) {
  const [isDeleting, setIsDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsDeleting(true);
    setError(null);
    try {
      await onConfirm();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <Dialog
      title="Delete Scratch Pad"
      titleId="delete-scratch-pad-title"
      onClose={onClose}
    >
      <DialogBody
        as="form"
        id="delete-scratch-pad-form"
        onSubmit={handleSubmit}
      >
        <p className={styles.bodyText}>
          Delete <strong>{pad.display_name ?? "this scratch pad"}</strong>? Its
          agents are stopped and every file in its folder is removed.
        </p>
        {error && <p className={styles.errorMsg}>{error}</p>}
      </DialogBody>
      <DialogFooter>
        <Button variant="secondary" type="button" onClick={onClose}>
          Cancel
        </Button>
        <Button
          variant="danger"
          disabled={isDeleting}
          form="delete-scratch-pad-form"
          type="submit"
        >
          {isDeleting ? "Deleting..." : "Delete"}
        </Button>
      </DialogFooter>
    </Dialog>
  );
}
