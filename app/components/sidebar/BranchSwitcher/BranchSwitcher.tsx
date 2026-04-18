import { useCallback, useEffect, useRef, useState } from "react";
import { Icons } from "@argus/peacock";
import { useOutsideClick } from "../../../hooks/useOutsideClick";
import { checkoutBranch, listBranches } from "../../../lib/ipc";
import styles from "./BranchSwitcher.module.css";

interface BranchSwitcherProps {
  currentBranch: string;
  disabled?: boolean;
  onBranchChanged: () => void;
  repoRoot: string;
}

export function BranchSwitcher({
  repoRoot,
  currentBranch,
  onBranchChanged,
  disabled,
}: BranchSwitcherProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [branches, setBranches] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);

  const open = useCallback(async () => {
    setIsOpen(true);
    setIsLoading(true);
    try {
      const list = await listBranches(repoRoot);
      setBranches(list);
    } catch {
      // Failed to list branches — close dropdown
      setIsOpen(false);
    } finally {
      setIsLoading(false);
    }
  }, [repoRoot]);

  const close = useCallback(() => {
    setIsOpen(false);
  }, []);

  const handleTriggerClick = useCallback(() => {
    if (isOpen) {
      close();
    } else {
      open().catch(() => {});
    }
  }, [isOpen, close, open]);

  const handleSelect = useCallback(
    async (branch: string) => {
      if (branch === currentBranch) {
        close();

        return;
      }

      try {
        await checkoutBranch(repoRoot, branch);
        close();
        onBranchChanged();
      } catch {
        // Checkout failed — keep dropdown open
      }
    },
    [repoRoot, currentBranch, close, onBranchChanged],
  );

  useOutsideClick(wrapperRef, isOpen, close);

  // Close on Escape
  useEffect(() => {
    if (!isOpen) {
      return;
    }
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        close();
      }
    };

    document.addEventListener("keydown", handleKey);

    return () => document.removeEventListener("keydown", handleKey);
  }, [isOpen, close]);

  return (
    <div ref={wrapperRef} className={styles.wrapper}>
      <button
        aria-disabled={disabled}
        className={`${styles.trigger} ${disabled ? styles.disabled : ""}`}
        onClick={disabled ? undefined : handleTriggerClick}
      >
        <Icons.BranchIcon size={11} />
        <span className={styles.triggerLabel}>{currentBranch}</span>
        <span className={styles.chevron}>
          <Icons.ChevronDownIcon size={10} />
        </span>
      </button>
      {isOpen && (
        <div className={styles.dropdown}>
          {isLoading ? (
            <div
              className={styles.branchItem}
              style={{ color: "var(--text-muted)" }}
            >
              Loading...
            </div>
          ) : (
            branches.map((branch) => (
              <button
                key={branch}
                className={`${styles.branchItem} ${branch === currentBranch ? styles.branchItemActive : ""}`}
                onClick={() => handleSelect(branch)}
              >
                {branch}
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}
