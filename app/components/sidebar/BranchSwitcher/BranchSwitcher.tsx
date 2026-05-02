import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { Icons } from "@argus/peacock";
import { useOutsideClick } from "../../../hooks/useOutsideClick";
import {
  checkoutBranch,
  getUserProjectSettings,
  listBranches,
  readArgusConfig,
} from "../../../lib/ipc";
import styles from "./BranchSwitcher.module.css";

interface BranchSwitcherProps {
  claimedBranches: ReadonlySet<string>;
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

interface BranchGroup {
  branches: string[];
  key: string;
  label: string;
}

const BUILTIN_PROTECTED_ORDER = [
  "main",
  "master",
  "staging",
  "development",
  "dev",
  "develop",
];

function buildGroups(
  branches: string[],
  currentBranch: string,
  protectedBranches: string[],
  branchPrefix: string,
  claimedBranches: ReadonlySet<string>,
): BranchGroup[] {
  const seen = new Set<string>();
  const all = new Set(branches);

  const current: string[] = [];
  if (all.has(currentBranch)) {
    current.push(currentBranch);
    seen.add(currentBranch);
  }

  const protectedOrder = [
    ...BUILTIN_PROTECTED_ORDER,
    ...protectedBranches.filter((b) => !BUILTIN_PROTECTED_ORDER.includes(b)),
  ];
  const protectedList: string[] = [];
  for (const b of protectedOrder) {
    if (!seen.has(b) && all.has(b) && !claimedBranches.has(b)) {
      protectedList.push(b);
      seen.add(b);
    }
  }

  const prefixed: string[] = [];
  const others: string[] = [];
  const remaining = branches
    .filter((b) => !seen.has(b) && !claimedBranches.has(b))
    .sort((a, b) => a.localeCompare(b));
  for (const b of remaining) {
    if (branchPrefix && b.startsWith(branchPrefix)) {
      prefixed.push(b);
    } else {
      others.push(b);
    }
  }

  return [
    { key: "current", label: "Current", branches: current },
    { key: "protected", label: "Protected", branches: protectedList },
    { key: "yours", label: "Yours", branches: prefixed },
    { key: "other", label: "Other", branches: others },
  ].filter((g) => g.branches.length > 0);
}

export function BranchSwitcher({
  repoRoot,
  currentBranch,
  onBranchChanged,
  disabled,
  claimedBranches,
}: BranchSwitcherProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [branches, setBranches] = useState<string[]>([]);
  const [protectedBranches, setProtectedBranches] = useState<string[]>([]);
  const [branchPrefix, setBranchPrefix] = useState("");
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
      const [list, config, settings] = await Promise.all([
        listBranches(repoRoot),
        readArgusConfig(repoRoot).catch(() => null),
        getUserProjectSettings(repoRoot).catch(() => null),
      ]);
      setBranches(list);
      setProtectedBranches(config?.protected_branches ?? []);
      setBranchPrefix(settings?.branch_prefix ?? "");
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

  const groups = useMemo(
    () =>
      buildGroups(
        branches,
        currentBranch,
        protectedBranches,
        branchPrefix,
        claimedBranches,
      ),
    [branches, currentBranch, protectedBranches, branchPrefix, claimedBranches],
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
            {isLoading && (
              <div className={`${styles.branchItem} ${styles.loading}`}>
                Loading...
              </div>
            )}
            {!isLoading && groups.length === 0 && (
              <div className={`${styles.branchItem} ${styles.loading}`}>
                No branches
              </div>
            )}
            {!isLoading &&
              groups.length > 0 &&
              groups.map((group) => (
                <div key={group.key} className={styles.group}>
                  <div className={styles.groupLabel}>{group.label}</div>
                  {group.branches.map((branch) => (
                    <button
                      key={branch}
                      className={`${styles.branchItem} ${branch === currentBranch ? styles.branchItemActive : ""}`}
                      onClick={() => handleSelect(branch)}
                    >
                      {branch}
                    </button>
                  ))}
                </div>
              ))}
          </div>,
          document.body,
        )}
    </div>
  );
}
