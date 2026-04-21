import type { Session } from "../../../lib/types";
import { useState } from "react";
import { Button } from "@argus/peacock";
import { renameSessionBranch } from "../../../lib/ipc";
import { Dialog, dialogStyles as styles } from "../../shared/Dialog";

interface RenameBranchDialogProps {
  onClose: () => void;
  session: Session;
}

export function RenameBranchDialog({
  session,
  onClose,
}: RenameBranchDialogProps) {
  const [name, setName] = useState(session.branch);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) {
      setError("Branch name cannot be empty");

      return;
    }
    setIsSaving(true);
    setError(null);
    try {
      await renameSessionBranch(session.id, trimmed);
      onClose();
    } catch (err) {
      setError(typeof err === "string" ? err : "Failed to rename branch");
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Dialog
      title="Rename branch"
      titleId="rename-branch-title"
      onClose={onClose}
    >
      <form className={styles.form} onSubmit={handleSubmit}>
        <div className={styles.field}>
          <label className={styles.label} htmlFor="rename-branch-name">
            Branch name
            <span className={styles.labelHint}>— spaces become hyphens</span>
          </label>
          <input
            id="rename-branch-name"
            autoFocus
            className={styles.input}
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onFocus={(e) => e.target.select()}
          />
        </div>

        {error && <p className={styles.errorMsg}>{error}</p>}

        <div className={styles.footer}>
          <Button variant="secondary" type="button" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" disabled={isSaving} type="submit">
            {isSaving ? "Renaming…" : "Rename"}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
