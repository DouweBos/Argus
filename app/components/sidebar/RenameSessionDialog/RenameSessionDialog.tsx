import type { Session } from "../../../lib/types";
import { useState } from "react";
import { Button } from "@argus/peacock";
import { renameSession } from "../../../lib/ipc";
import { Dialog, dialogStyles as styles } from "../../shared/Dialog";

interface RenameSessionDialogProps {
  onClose: () => void;
  session: Session;
}

export function RenameSessionDialog({
  session,
  onClose,
}: RenameSessionDialogProps) {
  const [name, setName] = useState(session.display_name ?? session.branch);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) {
      setError("Name cannot be empty");

      return;
    }
    setIsSaving(true);
    setError(null);
    try {
      await renameSession(session.id, trimmed);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to rename session");
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Dialog title="Rename Session" titleId="rename-ws-title" onClose={onClose}>
      <form className={styles.form} onSubmit={handleSubmit}>
        <div className={styles.field}>
          <label className={styles.label} htmlFor="rename-ws-name">
            Display Name
          </label>
          <input
            id="rename-ws-name"
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
            {isSaving ? "Saving..." : "Save"}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
