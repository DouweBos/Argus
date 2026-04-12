import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useOverlayDismiss } from "../../../hooks/useOverlayDismiss";
import { useProjectWorkspaces } from "../../../hooks/useWorkspaces";
import { listAllBranches } from "../../../lib/ipc";
import { CloseIcon } from "../../shared/Icons";
import styles from "../Dialog/Dialog.module.css";

interface CreateWorkspaceDialogProps {
  onClose: () => void;
  repoRoot: string;
  /** When set, the new workspace forks from this workspace's branch instead of project root HEAD. */
  sourceWorkspace?: { branch: string; display_name?: string | null } | null;
}

function filterBranches(branches: string[], query: string): string[] {
  const q = query.trim().toLowerCase();
  if (!q) {
    return branches;
  }

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
  const [error, setError] = useState<string | null>(null);
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
    if (!trimmedBranch) {
      return;
    }
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

  let branchListBody: ReactNode;
  if (branchesLoading) {
    branchListBody = (
      <div className={styles.branchListEmpty}>Loading branches…</div>
    );
  } else if (hasSuggestions) {
    branchListBody = (
      <>
        {localSuggestions.length > 0 && (
          <>
            <div className={styles.branchSectionHeader}>Local</div>
            {localSuggestions.map((b) => (
              <button
                key={b}
                className={`${styles.branchItem} ${b === trimmedBranch ? styles.branchItemSelected : ""}`}
                type="button"
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
                className={`${styles.branchItem} ${b === trimmedBranch ? styles.branchItemSelected : ""}`}
                type="button"
                onClick={() => selectBranch(b)}
              >
                {b}
              </button>
            ))}
          </>
        )}
      </>
    );
  } else if (trimmedBranch) {
    branchListBody = (
      <div className={styles.branchListEmpty}>No matching branches</div>
    );
  } else {
    branchListBody = (
      <div className={styles.branchListEmpty}>No branches found</div>
    );
  }

  return (
    <div className={styles.overlay} {...overlay}>
      <div
        aria-labelledby="create-ws-title"
        aria-modal="true"
        className={`${styles.dialog} ${styles.dialogLarge}`}
        role="dialog"
      >
        <div className={styles.header}>
          <h2 className={styles.title} id="create-ws-title">
            New Workspace
            {sourceWorkspace && (
              <span className={styles.subtitle}>
                from {sourceWorkspace.display_name ?? sourceWorkspace.branch}
              </span>
            )}
          </h2>
          <button
            aria-label="Close"
            className={styles.closeBtn}
            onClick={onClose}
          >
            <CloseIcon size={14} />
          </button>
        </div>

        <form className={styles.form} onSubmit={handleSubmit}>
          <div className={styles.field}>
            <label className={styles.label} htmlFor="branch-input">
              Branch
            </label>
            <input
              ref={inputRef}
              autoComplete="off"
              autoFocus
              className={styles.input}
              id="branch-input"
              placeholder="Search or create branch…"
              type="text"
              value={branch}
              onChange={(e) => setBranch(e.target.value)}
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

          <div className={styles.branchList}>{branchListBody}</div>

          <div className={styles.field}>
            <label className={styles.label} htmlFor="description-input">
              Description
            </label>
            <input
              className={styles.input}
              id="description-input"
              placeholder="What are you building?"
              type="text"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>

          {error && <p className={styles.errorMsg}>{error}</p>}

          <div className={styles.footer}>
            <button
              className={styles.cancelBtn}
              type="button"
              onClick={onClose}
            >
              Cancel
            </button>
            <button
              className={styles.submitBtn}
              disabled={isCreating || !trimmedBranch}
              type="submit"
            >
              {isCreating ? "Creating..." : "Create Workspace"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
