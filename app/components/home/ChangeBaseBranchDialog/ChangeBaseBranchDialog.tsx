import type { Session } from "../../../lib/types";
import { useEffect, useState } from "react";
import { Button } from "@argus/peacock";
import { listBranches, setSessionBaseBranch } from "../../../lib/ipc";
import { updateSession } from "../../../stores/sessionStore";
import { Dialog, dialogStyles as styles } from "../../shared/Dialog";

interface ChangeBaseBranchDialogProps {
  onClose: () => void;
  session: Session;
}

export function ChangeBaseBranchDialog({
  session,
  onClose,
}: ChangeBaseBranchDialogProps) {
  const [branches, setBranches] = useState<string[]>([]);
  const [selected, setSelected] = useState<string>(session.base_branch ?? "");
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const list = await listBranches(session.repo_root);
        if (cancelled) {
          return;
        }
        setBranches(list);
      } catch (err) {
        if (cancelled) {
          return;
        }
        setError(typeof err === "string" ? err : "Failed to load branches");
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [session.repo_root]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = selected.trim();
    if (!trimmed) {
      setError("Pick a branch");

      return;
    }
    if (trimmed === session.branch) {
      setError("Source branch cannot be the session's own branch");

      return;
    }
    if (trimmed === session.base_branch) {
      onClose();

      return;
    }
    setIsSaving(true);
    setError(null);
    try {
      await setSessionBaseBranch(session.id, trimmed);
      updateSession(session.id, { base_branch: trimmed });
      onClose();
    } catch (err) {
      setError(typeof err === "string" ? err : "Failed to change source branch");
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Dialog
      title="Change source branch"
      titleId="change-base-branch-title"
      onClose={onClose}
    >
      <form className={styles.form} onSubmit={handleSubmit}>
        <p className={styles.bodyText}>
          Pick the branch that this session is compared against for merges,
          rebases, and diffs. This only updates the reference — no git state
          changes.
        </p>

        <div className={styles.field}>
          <label className={styles.label}>Source branch</label>
          <div className={styles.branchList}>
            {isLoading && (
              <div className={styles.branchListEmpty}>Loading branches…</div>
            )}
            {!isLoading && branches.length === 0 && (
              <div className={styles.branchListEmpty}>No branches found</div>
            )}
            {!isLoading &&
              branches.map((b) => {
                const isSelf = b === session.branch;

                return (
                  <button
                    key={b}
                    type="button"
                    className={`${styles.branchItem} ${b === selected ? styles.branchItemSelected : ""}`}
                    disabled={isSelf}
                    title={isSelf ? "This is the session's own branch" : undefined}
                    onClick={() => setSelected(b)}
                  >
                    {b}
                  </button>
                );
              })}
          </div>
        </div>

        {error && <p className={styles.errorMsg}>{error}</p>}

        <div className={styles.footer}>
          <Button variant="secondary" type="button" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            disabled={isSaving || isLoading || !selected}
            type="submit"
          >
            {isSaving ? "Saving…" : "Save"}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
