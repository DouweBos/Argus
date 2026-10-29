import { type ReactNode, type RefObject, useEffect, useState } from "react";
import { CheckIcon } from "../../icons/Icons";
import { Input } from "../Input/Input";
import { Kbd } from "../Kbd/Kbd";
import { PickerPopover } from "../PickerPopover/PickerPopover";
import styles from "./OptionMenu.module.css";

export interface OptionMenuItem {
  icon?: ReactNode;
  label: string;
  /** A single key that picks this item while the menu is open. */
  shortcut?: string;
  value: string;
}

export interface OptionMenuProps {
  items: OptionMenuItem[];
  onClose: () => void;
  onSelect: (value: string) => void;
  /** "Change status…" */
  placeholder: string;
  /** Shown beside the search field, e.g. the key that opened the menu. */
  hint?: string;
  selected?: string | null;
  triggerRef: RefObject<HTMLElement | null>;
}

/**
 * Linear's property menu: type to filter, a number picks its row, Return the
 * first match, Escape closes.
 */
export function OptionMenu({
  hint,
  items,
  onClose,
  onSelect,
  placeholder,
  selected,
  triggerRef,
}: OptionMenuProps) {
  const [query, setQuery] = useState("");
  const needle = query.trim().toLowerCase();
  const shown = items.filter((item) =>
    item.label.toLowerCase().includes(needle),
  );

  const pick = (value: string) => {
    onSelect(value);
    onClose();
  };

  // Shortcuts only while nothing is typed, so digits in a search still type.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (query || e.metaKey || e.ctrlKey || e.altKey) {
        return;
      }
      const item = items.find((i) => i.shortcut === e.key);
      if (item) {
        e.preventDefault();
        pick(item.value);
      }
    };
    window.addEventListener("keydown", onKey, true);

    return () => window.removeEventListener("keydown", onKey, true);
  });

  return (
    <PickerPopover
      placement="below"
      triggerRef={triggerRef}
      width={260}
      onClose={onClose}
    >
      <div className={styles.search}>
        <Input
          autoFocus
          bare
          aria-label={placeholder}
          placeholder={placeholder}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && shown[0]) {
              pick(shown[0].value);
            }
          }}
        />
        {hint && <Kbd keys={[hint]} />}
      </div>
      <div className={styles.list}>
        {shown.map((item) => (
          <button
            key={item.value}
            aria-selected={item.value === selected}
            className={
              item.value === selected ? styles.rowSelected : styles.row
            }
            role="option"
            type="button"
            onClick={() => pick(item.value)}
          >
            <span className={styles.icon}>{item.icon}</span>
            <span className={styles.label}>{item.label}</span>
            {item.value === selected && <CheckIcon size={11} />}
            {item.shortcut && (
              <span className={styles.shortcut}>{item.shortcut}</span>
            )}
          </button>
        ))}
      </div>
    </PickerPopover>
  );
}
