import { useState } from "react";
import { useOverlayDismiss } from "../../hooks/useOverlayDismiss";
import type { Workspace } from "../../lib/types";
import { CloseIcon } from "../shared/Icons";
import styles from "./Dialog.module.css";

interface DeleteWorkspaceDialogProps {
  onClose: () => void;
  onConfirm: (deleteBranch: boolean) => Promise<void>;
  workspace: Workspace;
}

export function DeleteWorkspaceDialog({
  workspace,
  onClose,
  onConfirm,
}: DeleteWorkspaceDialogProps) {
  const [deleteBranch, setDeleteBranch] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [error, setError] = useState<null | string>(null);

  const displayName = workspace.display_name ?? workspace.branch;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsDeleting(true);
    setError(null);
    try {
      await onConfirm(deleteBranch);
      onClose();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to delete workspace",
      );
    } finally {
      setIsDeleting(false);
    }
  };

  const overlay = useOverlayDismiss(onClose);

  return (
    <div className={styles.overlay} {...overlay}>
      <div
        className={styles.dialog}
        role="dialog"
        aria-modal="true"
        aria-labelledby="delete-ws-title"
      >
        <div className={styles.header}>
          <h2 id="delete-ws-title" className={styles.title}>
            Delete Workspace
          </h2>
          <button
            className={styles.closeBtn}
            onClick={onClose}
            aria-label="Close"
          >
            <CloseIcon size={14} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className={styles.form}>
          <p className={styles.bodyText}>
            Are you sure you want to delete <strong>{displayName}</strong>? This
            will remove the worktree and any uncommitted changes.
          </p>

          <label className={styles.checkboxRow}>
            <input
              type="checkbox"
              checked={deleteBranch}
              onChange={(e) => setDeleteBranch(e.target.checked)}
            />
            Also delete branch <code>{workspace.branch}</code>
          </label>

          {error && <p className={styles.errorMsg}>{error}</p>}

          <div className={styles.footer}>
            <button
              type="button"
              className={styles.cancelBtn}
              onClick={onClose}
            >
              Cancel
            </button>
            <button
              type="submit"
              className={styles.submitBtnDanger}
              disabled={isDeleting}
            >
              {isDeleting ? "Deleting..." : "Delete"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
