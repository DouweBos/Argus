import type { MentionPickerItem } from "../ChatInput/useMentionPicker";
import { useEffect, useRef } from "react";
import styles from "./FileMentionPicker.module.css";

interface FileMentionPickerProps {
  headerText: string;
  items: MentionPickerItem[];
  onSelect: (index: number) => void;
  onSelectedIndexChange: (index: number) => void;
  selectedIndex: number;
}

export function FileMentionPicker({
  items,
  headerText,
  selectedIndex,
  onSelectedIndexChange,
  onSelect,
}: FileMentionPickerProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  // Scroll selected item into view
  useEffect(() => {
    const container = containerRef.current;
    if (!container) {
      return;
    }

    // +1 to skip the header element at children[0]
    const selected = container.children[selectedIndex + 1] as HTMLElement;
    selected?.scrollIntoView({ block: "nearest" });
  }, [selectedIndex]);

  if (items.length === 0) {
    return (
      <div ref={containerRef} className={styles.picker}>
        <div className={styles.header}>{headerText}</div>
        <div className={styles.empty}>No matching files</div>
      </div>
    );
  }

  return (
    <div ref={containerRef} className={styles.picker}>
      <div className={styles.header}>{headerText}</div>
      {items.map((item, i) => (
        <button
          key={
            item.isLinkAction
              ? "__link__"
              : `${item.hint ?? ""}/${item.display}`
          }
          className={`${styles.item} ${i === selectedIndex ? styles.itemActive : ""} ${item.isLinkAction ? styles.itemLink : ""}`}
          onMouseDown={(e) => {
            e.preventDefault();
            onSelect(i);
          }}
          onMouseEnter={() => onSelectedIndexChange(i)}
        >
          {item.isLinkAction ? (
            <>
              <span className={styles.linkLabel}>Link directory</span>
              <span className={styles.linkPath}>{item.display}</span>
            </>
          ) : (
            <>
              {item.isDir && <span className={styles.dirSlash}>/</span>}
              <span className={styles.fileName}>{item.display}</span>
              {item.hint && (
                <span className={styles.filePath}>{item.hint}</span>
              )}
              {item.isDir && !item.hint && (
                <span className={styles.dirIndicator}>&rsaquo;</span>
              )}
            </>
          )}
        </button>
      ))}
    </div>
  );
}
