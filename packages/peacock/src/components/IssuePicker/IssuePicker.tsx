import type { RefObject } from "react";
import { CheckboxRow } from "../CheckboxRow/CheckboxRow";
import { Input } from "../Input/Input";
import { PickerPopover } from "../PickerPopover/PickerPopover";
import { Spinner } from "../Spinner/Spinner";
import styles from "./IssuePicker.module.css";

export interface IssuePickerItem {
  id: string;
  /** `ENG-123`. */
  identifier: string;
  title: string;
  /** Workflow state name, e.g. "In Progress". */
  state: string;
}

export interface IssuePickerProps {
  /** Shown when there's nothing to list and nothing failed. */
  emptyText?: string;
  error?: string | null;
  items: IssuePickerItem[];
  loading?: boolean;
  onClose: () => void;
  onQueryChange: (query: string) => void;
  onToggle: (item: IssuePickerItem) => void;
  query: string;
  selectedIds: string[];
  triggerRef: RefObject<HTMLElement | null>;
}

/**
 * Search a tracker's issues and pick several. Toggling keeps it open so a few
 * issues can be picked in one go; each becomes its own agent.
 */
export function IssuePicker({
  emptyText = "No open issues assigned to you.",
  error,
  items,
  loading = false,
  onClose,
  onQueryChange,
  onToggle,
  query,
  selectedIds,
  triggerRef,
}: IssuePickerProps) {
  const selected = new Set(selectedIds);

  return (
    <PickerPopover triggerRef={triggerRef} onClose={onClose}>
      <div className={styles.search}>
        <Input
          autoFocus
          aria-label="Search issues"
          placeholder="Search, or paste ENG-123 or a link"
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
        />
        {loading && <Spinner size="xs" tone="muted" />}
      </div>
      {error && <p className={styles.error}>{error}</p>}
      {!error && items.length === 0 && !loading && (
        <PickerPopover.Empty>{emptyText}</PickerPopover.Empty>
      )}
      {!error && items.length > 0 && (
        <div className={styles.list}>
          {items.map((item) => (
            <CheckboxRow
              key={item.id}
              checked={selected.has(item.id)}
              detail={item.identifier}
              label={item.title}
              trailing={item.state}
              onChange={() => onToggle(item)}
            />
          ))}
        </div>
      )}
    </PickerPopover>
  );
}
