import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
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

interface DropdownRect {
  left: number;
  top: number;
  width: number;
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
  const [rect, setRect] = useState<DropdownRect | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const updateRect = useCallback(() => {
    const node = triggerRef.current;
    if (!node) {
      return;
    }
    const r = node.getBoundingClientRect();
    setRect({ left: r.left, top: r.bottom + 2, width: r.width });
  }, []);

  const open = useCallback(async () => {
    updateRect();
    setIsOpen(true);
    setIsLoading(true);
    try {
      const list = await listBranches(repoRoot);
      setBranches(list);
    } catch {
      setIsOpen(false);
    } finally {
      setIsLoading(false);
    }
  }, [repoRoot, updateRect]);

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

  useOutsideClick(dropdownRef, isOpen, close, (target) => {
    return triggerRef.current?.contains(target) ?? false;
  });

  useLayoutEffect(() => {
    if (!isOpen) {
      return;
    }
    updateRect();
    const handle = () => updateRect();
    window.addEventListener("resize", handle);
    window.addEventListener("scroll", handle, true);

    return () => {
      window.removeEventListener("resize", handle);
      window.removeEventListener("scroll", handle, true);
    };
  }, [isOpen, updateRect]);

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
    <div className={styles.wrapper}>
      <button
        ref={triggerRef}
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
      {isOpen &&
        rect &&
        createPortal(
          <div
            ref={dropdownRef}
            className={styles.dropdown}
            style={{
              left: rect.left,
              top: rect.top,
              width: rect.width,
            }}
          >
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
          </div>,
          document.body,
        )}
    </div>
  );
}
