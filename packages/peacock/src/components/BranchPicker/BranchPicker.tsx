import { useEffect, useId, useMemo, useRef, useState } from "react";
import { Button } from "../Button/Button";
import { Dialog } from "../Dialog/Dialog";
import { DialogBody } from "../Dialog/DialogBody";
import { DialogFooter } from "../Dialog/DialogFooter";
import { Input } from "../Input/Input";
import styles from "./BranchPicker.module.css";

export interface BranchPickerEntry {
  /** Display name (e.g. "feature/foo" or "origin/foo"). */
  name: string;
  /** Stable id — typically the full ref. */
  id: string;
  /** Optional remote name for grouping. Empty = local. */
  remote?: string;
  ahead?: number;
  behind?: number;
  /** True for the currently checked-out branch. */
  isCurrent?: boolean;
  /** Optional secondary line (e.g. last commit subject). */
  detail?: string;
}

export interface BranchPickerProps {
  open: boolean;
  branches: BranchPickerEntry[];
  /** Optional remote-tracking branches; rendered in a second section. */
  remoteBranches?: BranchPickerEntry[];
  title: string;
  confirmLabel: string;
  /** Initial filter text. */
  defaultFilter?: string;
  /** Optional empty-state copy. */
  emptyLabel?: string;
  onSelect: (entry: BranchPickerEntry) => void;
  onCancel: () => void;
}

/**
 * Searchable branch list dialog. Used by the Cmd+B checkout flow and by
 * drag-merge confirms in the project-root client.
 */
export function BranchPicker({
  open,
  branches,
  remoteBranches,
  title,
  confirmLabel,
  defaultFilter = "",
  emptyLabel = "No branches match",
  onSelect,
  onCancel,
}: BranchPickerProps) {
  const titleId = useId();
  const [filter, setFilter] = useState(defaultFilter);
  const [activeId, setActiveId] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setFilter(defaultFilter);
      setActiveId(null);
      // Focus the search field once the dialog mounts.
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open, defaultFilter]);

  const filteredLocal = useMemo(() => {
    const f = filter.toLowerCase();
    if (f.length === 0) {
      return branches;
    }

    return branches.filter(
      (e) =>
        e.name.toLowerCase().includes(f) ||
        (e.detail ?? "").toLowerCase().includes(f),
    );
  }, [branches, filter]);
  const filteredRemote = useMemo(() => {
    const list = remoteBranches ?? [];
    const f = filter.toLowerCase();
    if (f.length === 0) {
      return list;
    }

    return list.filter(
      (e) =>
        e.name.toLowerCase().includes(f) ||
        (e.detail ?? "").toLowerCase().includes(f),
    );
  }, [remoteBranches, filter]);

  const flatList = useMemo(
    () => [...filteredLocal, ...filteredRemote],
    [filteredLocal, filteredRemote],
  );

  const activeIndex = useMemo(() => {
    if (activeId == null) {
      return 0;
    }
    const idx = flatList.findIndex((b) => b.id === activeId);

    return idx >= 0 ? idx : 0;
  }, [activeId, flatList]);

  if (!open) {
    return null;
  }

  const move = (delta: number) => {
    if (flatList.length === 0) {
      return;
    }
    const next = (activeIndex + delta + flatList.length) % flatList.length;
    const target = flatList[next];
    if (target) {
      setActiveId(target.id);
    }
  };

  const handleConfirm = () => {
    const target = flatList[activeIndex];
    if (target) {
      onSelect(target);
    }
  };

  const renderRow = (entry: BranchPickerEntry) => {
    const active = entry.id === flatList[activeIndex]?.id;

    return (
      <li
        key={entry.id}
        className={[
          styles.row,
          active ? styles.rowActive : "",
          entry.isCurrent ? styles.rowCurrent : "",
        ]
          .filter(Boolean)
          .join(" ")}
        onClick={() => setActiveId(entry.id)}
        onDoubleClick={() => onSelect(entry)}
      >
        <span className={styles.rowName}>
          {entry.isCurrent && (
            <span className={styles.currentDot} aria-hidden />
          )}
          {entry.name}
        </span>
        {entry.detail && (
          <span className={styles.rowDetail}>{entry.detail}</span>
        )}
        {(entry.ahead ?? 0) + (entry.behind ?? 0) > 0 && (
          <span className={styles.rowCounts}>
            {(entry.ahead ?? 0) > 0 && <span>↑{entry.ahead}</span>}
            {(entry.behind ?? 0) > 0 && <span>↓{entry.behind}</span>}
          </span>
        )}
      </li>
    );
  };

  return (
    <Dialog onClose={onCancel} title={title} titleId={titleId} size="medium">
      <DialogBody
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") {
            e.preventDefault();
            move(1);
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            move(-1);
          } else if (e.key === "Enter") {
            e.preventDefault();
            handleConfirm();
          }
        }}
      >
        <Input
          ref={inputRef}
          placeholder="Filter branches…"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />
        {flatList.length === 0 ? (
          <div className={styles.empty}>{emptyLabel}</div>
        ) : (
          <div className={styles.scroll}>
            {filteredLocal.length > 0 && (
              <>
                <div className={styles.sectionLabel}>Local</div>
                <ul className={styles.list}>{filteredLocal.map(renderRow)}</ul>
              </>
            )}
            {filteredRemote.length > 0 && (
              <>
                <div className={styles.sectionLabel}>Remotes</div>
                <ul className={styles.list}>{filteredRemote.map(renderRow)}</ul>
              </>
            )}
          </div>
        )}
      </DialogBody>
      <DialogFooter>
        <Button variant="secondary" onClick={onCancel}>
          Cancel
        </Button>
        <Button
          variant="primary"
          onClick={handleConfirm}
          disabled={flatList.length === 0}
        >
          {confirmLabel}
        </Button>
      </DialogFooter>
    </Dialog>
  );
}
