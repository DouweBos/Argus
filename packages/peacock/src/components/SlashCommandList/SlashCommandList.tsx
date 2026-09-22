import { useEffect, useRef } from "react";
import styles from "./SlashCommandList.module.css";

export interface SlashCommandItem {
  description?: string;
  name: string;
}

export interface SlashCommandListProps {
  header?: string;
  items: readonly SlashCommandItem[];
  onSelect: (index: number) => void;
  onSelectedIndexChange: (index: number) => void;
  selectedIndex: number;
}

/**
 * Slash-command autocomplete above a composer. Keyboard selection drives
 * `selectedIndex`; the list only renders it and keeps it scrolled into view.
 */
export function SlashCommandList({
  header = "Commands",
  items,
  onSelect,
  onSelectedIndexChange,
  selectedIndex,
}: SlashCommandListProps) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // +1 to skip the header element at children[0].
    const selected = ref.current?.children[selectedIndex + 1] as
      | HTMLElement
      | undefined;
    selected?.scrollIntoView({ block: "nearest" });
  }, [selectedIndex]);

  if (items.length === 0) {
    return null;
  }

  return (
    <div ref={ref} className={styles.list}>
      <div className={styles.header}>{header}</div>
      {items.map((cmd, i) => (
        <button
          key={cmd.name}
          type="button"
          className={`${styles.item} ${i === selectedIndex ? styles.active : ""}`}
          // mousedown, so selecting never blurs the composer first.
          onMouseDown={(e) => {
            e.preventDefault();
            onSelect(i);
          }}
          onMouseEnter={() => onSelectedIndexChange(i)}
        >
          <span className={styles.slash}>/</span>
          <span className={styles.name}>{cmd.name}</span>
          {cmd.description && (
            <span className={styles.description}>{cmd.description}</span>
          )}
        </button>
      ))}
    </div>
  );
}
