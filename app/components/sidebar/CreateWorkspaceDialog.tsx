import { useCallback, useEffect, useRef, useState } from "react";
import { listBranches } from "../../lib/ipc";
import { useOverlayDismiss } from "../../hooks/useOverlayDismiss";
import { useProjectWorkspaces } from "../../hooks/useWorkspaces";
import { CloseIcon, ChevronDownIcon } from "../shared/Icons";
import styles from "./Dialog.module.css";

interface CreateWorkspaceDialogProps {
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
}: CreateWorkspaceDialogProps) {
  const { createWorkspace } = useProjectWorkspaces(repoRoot);
  const [branch, setBranch] = useState("");
  const [branches, setBranches] = useState<string[]>([]);
  const [branchesLoading, setBranchesLoading] = useState(false);
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const [description, setDescription] = useState("");
  const [isCreating, setIsCreating] = useState(false);
  const [error, setError] = useState<null | string>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);

  const fetchBranches = useCallback(async () => {
    setBranchesLoading(true);
    try {
      const list = await listBranches(repoRoot);
      setBranches(list);
    } catch {
      setBranches([]);
    } finally {
      setBranchesLoading(false);
    }
  }, [repoRoot]);

  useEffect(() => {
    fetchBranches();
  }, [fetchBranches]);

  const suggestions = filterBranches(branches, branch);
  const trimmedBranch = branch.trim();
  const isExistingBranch =
    trimmedBranch.length > 0 && branches.includes(trimmedBranch);
  const willCreateNew =
    trimmedBranch.length > 0 && !branches.includes(trimmedBranch);

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
    setIsDropdownOpen(false);
    inputRef.current?.blur();
  }, []);

  useEffect(() => {
    if (!isDropdownOpen) return;
    const handleClick = (e: MouseEvent) => {
      if (
        wrapperRef.current &&
        !wrapperRef.current.contains(e.target as Node)
      ) {
        setIsDropdownOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [isDropdownOpen]);

  useEffect(() => {
    if (!isDropdownOpen) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setIsDropdownOpen(false);
    };
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [isDropdownOpen]);

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
          <div className={styles.field} ref={wrapperRef}>
            <label className={styles.label} htmlFor="branch-input">
              Branch
            </label>
            <div className={styles.comboboxWrapper}>
              <input
                ref={inputRef}
                id="branch-input"
                className={styles.comboboxInput}
                type="text"
                value={branch}
                onChange={(e) => setBranch(e.target.value)}
                placeholder="Type to search or create…"
                autoFocus
                autoComplete="off"
              />
              <button
                type="button"
                className={styles.comboboxTrigger}
                onClick={() => setIsDropdownOpen((o) => !o)}
                aria-label="Show branch suggestions"
                aria-expanded={isDropdownOpen}
              >
                <ChevronDownIcon />
              </button>
              {isDropdownOpen && (
                <div className={styles.comboboxDropdown}>
                  {branchesLoading ? (
                    <div className={styles.comboboxItemMuted}>
                      Loading branches…
                    </div>
                  ) : suggestions.length > 0 ? (
                    suggestions.map((b) => (
                      <button
                        key={b}
                        type="button"
                        className={styles.comboboxItem}
                        onClick={() => selectBranch(b)}
                      >
                        {b}
                      </button>
                    ))
                  ) : trimmedBranch ? (
                    <div className={styles.comboboxItemMuted}>
                      No matching branches
                    </div>
                  ) : (
                    <div className={styles.comboboxItemMuted}>
                      No branches in repo
                    </div>
                  )}
                </div>
              )}
            </div>
            {willCreateNew && (
              <span className={styles.createNewHint}>
                Will create new branch: <strong>{trimmedBranch}</strong>
              </span>
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
