import type { Workspace } from "../../../lib/types";
import { useState } from "react";
import { Dialog, dialogStyles as styles } from "../../shared/Dialog";

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
  const [error, setError] = useState<string | null>(null);

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

  return (
    <Dialog
      title="Delete Workspace"
      titleId="delete-ws-title"
      onClose={onClose}
    >
      <form className={styles.form} onSubmit={handleSubmit}>
        <p className={styles.bodyText}>
          Are you sure you want to delete <strong>{displayName}</strong>? This
          will remove the worktree and any uncommitted changes.
        </p>

        <label className={styles.checkboxRow}>
          <input
            checked={deleteBranch}
            type="checkbox"
            onChange={(e) => setDeleteBranch(e.target.checked)}
          />
          Also delete branch <code>{workspace.branch}</code>
        </label>

        {error && <p className={styles.errorMsg}>{error}</p>}

        <div className={styles.footer}>
          <button className={styles.cancelBtn} type="button" onClick={onClose}>
            Cancel
          </button>
          <button
            className={styles.submitBtnDanger}
            disabled={isDeleting}
            type="submit"
          >
            {isDeleting ? "Deleting..." : "Delete"}
          </button>
        </div>
      </form>
    </Dialog>
  );
}
