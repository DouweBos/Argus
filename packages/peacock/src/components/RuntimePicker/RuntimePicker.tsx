import type { ContextMenuItem } from "../ContextMenu/ContextMenu";
import type { ReactNode } from "react";
import { useMemo, useRef, useState } from "react";
import * as Icons from "../../icons/Icons";
import { ContextMenu } from "../ContextMenu/ContextMenu";
import styles from "./RuntimePicker.module.css";

export interface RuntimePickerItem {
  id: string;
  label: string;
  selected?: boolean;
  trailing?: string;
  onSelect: () => void;
}

export interface RuntimePickerSection {
  header: string;
  items: RuntimePickerItem[];
}

export interface RuntimePickerProps {
  /** Icon shown inside the trigger pill. */
  icon: ReactNode;
  /** Label shown inside the trigger pill. */
  label: string;
  /** Render the label in muted color (e.g. when no device is selected). */
  muted?: boolean;
  /** Section groups rendered in the dropdown menu. Empty sections are skipped. */
  sections: RuntimePickerSection[];
}

/**
 * Compact runtime/device picker — the trigger pill + sectioned dropdown
 * used in the simulator toolbar. Presentational only; the caller maps
 * its devices into `sections` and provides the `icon`/`label` for the
 * trigger.
 */
export function RuntimePicker({
  icon,
  label,
  muted,
  sections,
}: RuntimePickerProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [menuPos, setMenuPos] = useState({ x: 0, y: 0 });
  const triggerRef = useRef<HTMLButtonElement | null>(null);

  const items = useMemo<ContextMenuItem[]>(() => {
    const list: ContextMenuItem[] = [];
    for (const section of sections) {
      if (section.items.length === 0) {
        continue;
      }
      if (list.length > 0) {
        list.push({ separator: true });
      }
      list.push({ header: section.header });
      for (const item of section.items) {
        list.push({
          label: item.label,
          trailing: item.trailing,
          selected: item.selected,
          onClick: () => {
            item.onSelect();
            setMenuOpen(false);
          },
        });
      }
    }

    return list;
  }, [sections]);

  const openMenu = () => {
    const el = triggerRef.current;
    if (!el) {
      return;
    }
    const rect = el.getBoundingClientRect();
    setMenuPos({ x: rect.left, y: rect.bottom + 4 });
    setMenuOpen(true);
  };

  return (
    <>
      <button
        ref={triggerRef}
        aria-expanded={menuOpen}
        aria-haspopup="menu"
        className={styles.trigger}
        type="button"
        onClick={openMenu}
      >
        <span className={styles.triggerIcon}>{icon}</span>
        <span
          className={`${styles.triggerLabel} ${muted ? styles.triggerLabelMuted : ""}`}
        >
          {label}
        </span>
        <Icons.ChevronDownIcon className={styles.triggerChevron} size={10} />
      </button>
      {menuOpen && (
        <ContextMenu
          items={items}
          position={menuPos}
          onClose={() => setMenuOpen(false)}
          triggerRef={triggerRef}
        />
      )}
    </>
  );
}
