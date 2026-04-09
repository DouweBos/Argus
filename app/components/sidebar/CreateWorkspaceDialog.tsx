import { useCallback, useEffect, useRef, useState } from "react";
import { listAllBranches } from "../../lib/ipc";
import { useOverlayDismiss } from "../../hooks/useOverlayDismiss";
import { useProjectWorkspaces } from "../../hooks/useWorkspaces";
import { CloseIcon } from "../shared/Icons";
import styles from "./Dialog.module.css";

interface CreateWorkspaceDialogProps {
  /** When set, the new workspace forks from this workspace's branch instead of project root HEAD. */
  sourceWorkspace?: { branch: string; display_name?: null | string } | null;
  onClose: () => void;
  repoRoot: string;
}

function filterBranches(branches: string[], query: string): string[] {
  const q = query.trim().toLowerCase();
  if (!q) return branches;
  return branches.filter((b) => b.toLowerCase().includes(q));
}

export function CreateWorkspaceDialog({
  repoRoot,
  onClose,
  sourceWorkspace,
}: CreateWorkspaceDialogProps) {
  const { createWorkspace } = useProjectWorkspaces(repoRoot);
  const [branch, setBranch] = useState("");
  const [localBranches, setLocalBranches] = useState<string[]>([]);
  const [remoteBranches, setRemoteBranches] = useState<string[]>([]);
  const [branchesLoading, setBranchesLoading] = useState(false);
  const [description, setDescription] = useState("");
  const [isCreating, setIsCreating] = useState(false);
  const [error, setError] = useState<null | string>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const fetchBranches = useCallback(async () => {
    setBranchesLoading(true);
    try {
      const list = await listAllBranches(repoRoot);
      setLocalBranches(list.local);
      setRemoteBranches(list.remote);
    } catch {
      setLocalBranches([]);
      setRemoteBranches([]);
    } finally {
      setBranchesLoading(false);
    }
  }, [repoRoot]);

  useEffect(() => {
    fetchBranches();
  }, [fetchBranches]);

  const localSuggestions = filterBranches(localBranches, branch);
  const remoteSuggestions = filterBranches(remoteBranches, branch);
  const hasSuggestions =
    localSuggestions.length > 0 || remoteSuggestions.length > 0;

  const trimmedBranch = branch.trim();
  const isExistingLocal =
    trimmedBranch.length > 0 && localBranches.includes(trimmedBranch);
  const isExistingRemote =
    trimmedBranch.length > 0 && remoteBranches.includes(trimmedBranch);
  const isExistingBranch = isExistingLocal || isExistingRemote;
  const willCreateNew = trimmedBranch.length > 0 && !isExistingBranch;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!trimmedBranch) return;
    setIsCreating(true);
    setError(null);
    try {
      await createWorkspace(
        trimmedBranch,
        description.trim(),
        isExistingBranch,
        sourceWorkspace?.branch,
      );
      onClose();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to create workspace",
      );
    } finally {
      setIsCreating(false);
    }
  };

  const overlay = useOverlayDismiss(onClose);

  const selectBranch = useCallback((b: string) => {
    setBranch(b);
    inputRef.current?.focus();
  }, []);

  return (
    <div className={styles.overlay} {...overlay}>
      <div
        className={`${styles.dialog} ${styles.dialogLarge}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="create-ws-title"
      >
        <div className={styles.header}>
          <h2 id="create-ws-title" className={styles.title}>
            New Workspace
            {sourceWorkspace && (
              <span className={styles.subtitle}>
                from {sourceWorkspace.display_name ?? sourceWorkspace.branch}
              </span>
            )}
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
          <div className={styles.field}>
            <label className={styles.label} htmlFor="branch-input">
              Branch
            </label>
            <input
              ref={inputRef}
              id="branch-input"
              className={styles.input}
              type="text"
              value={branch}
              onChange={(e) => setBranch(e.target.value)}
              placeholder="Search or create branch…"
              autoFocus
              autoComplete="off"
            />
            {isExistingRemote && !isExistingLocal && (
              <span className={styles.createNewHint}>
                Will create workspace from remote branch:{" "}
                <strong>{trimmedBranch}</strong>
              </span>
            )}
            {willCreateNew && (
              <span className={styles.createNewHint}>
                Will create new branch: <strong>{trimmedBranch}</strong>
              </span>
            )}
          </div>

          <div className={styles.branchList}>
            {branchesLoading ? (
              <div className={styles.branchListEmpty}>
                Loading branches…
              </div>
            ) : hasSuggestions ? (
              <>
                {localSuggestions.length > 0 && (
                  <>
                    <div className={styles.branchSectionHeader}>Local</div>
                    {localSuggestions.map((b) => (
                      <button
                        key={b}
                        type="button"
                        className={`${styles.branchItem} ${b === trimmedBranch ? styles.branchItemSelected : ""}`}
                        onClick={() => selectBranch(b)}
                      >
                        {b}
                      </button>
                    ))}
                  </>
                )}
                {remoteSuggestions.length > 0 && (
                  <>
                    <div className={styles.branchSectionHeader}>Remote</div>
                    {remoteSuggestions.map((b) => (
                      <button
                        key={`remote:${b}`}
                        type="button"
                        className={`${styles.branchItem} ${b === trimmedBranch ? styles.branchItemSelected : ""}`}
                        onClick={() => selectBranch(b)}
                      >
                        {b}
                      </button>
                    ))}
                  </>
                )}
              </>
            ) : trimmedBranch ? (
              <div className={styles.branchListEmpty}>
                No matching branches
              </div>
            ) : (
              <div className={styles.branchListEmpty}>
                No branches found
              </div>
            )}
          </div>

          <div className={styles.field}>
            <label className={styles.label} htmlFor="description-input">
              Description
            </label>
            <input
              id="description-input"
              className={styles.input}
              type="text"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="What are you building?"
            />
          </div>

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
              className={styles.submitBtn}
              disabled={isCreating || !trimmedBranch}
            >
              {isCreating ? "Creating..." : "Create Workspace"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
