import type { A11yEntry } from "./types";
import { useEffect, useMemo, useRef } from "react";
import styles from "./AccessibilityList.module.css";
import { selectNode, useInspectionSelection } from "./store";

interface AccessibilityListProps {
  entries: A11yEntry[];
}

/**
 * Numbered list of accessibility elements, sorted by the platform's
 * accessibility order — i.e. the sequence a screen reader would visit. Each
 * row is clickable and selects the underlying node so its metadata opens in
 * the side panel and its badge highlights on the canvas.
 */
export function AccessibilityList({ entries }: AccessibilityListProps) {
  const { selectedNodeId } = useInspectionSelection();
  const containerRef = useRef<HTMLDivElement | null>(null);

  const sorted = useMemo(
    () => entries.slice().sort((a, b) => a.order - b.order),
    [entries],
  );

  useEffect(() => {
    if (!selectedNodeId || !containerRef.current) {
      return;
    }
    const handle = window.requestAnimationFrame(() => {
      const el = containerRef.current?.querySelector<HTMLElement>(
        `[data-node-id="${CSS.escape(selectedNodeId)}"]`,
      );
      el?.scrollIntoView({ block: "nearest", behavior: "smooth" });
    });

    return () => window.cancelAnimationFrame(handle);
  }, [selectedNodeId]);

  if (sorted.length === 0) {
    return (
      <div className={styles.empty}>
        No accessibility elements were reported for this capture.
      </div>
    );
  }

  return (
    <div ref={containerRef} className={styles.list} role="list">
      {sorted.map((entry) => {
        const isSelected = selectedNodeId === entry.nodeId;
        const classes = [styles.row];
        if (isSelected) {
          classes.push(styles.rowSelected);
        }
        const primary = entry.label ?? entry.value ?? entry.role ?? "—";
        const secondary = secondaryLineFor(entry);

        return (
          <div
            key={entry.nodeId}
            data-node-id={entry.nodeId}
            className={classes.join(" ")}
            role="listitem"
            onClick={() => selectNode(entry.nodeId)}
          >
            <span className={styles.order}>{entry.order}</span>
            <span className={styles.body}>
              <span className={styles.primary}>{primary}</span>
              {secondary && (
                <span className={styles.secondary}>{secondary}</span>
              )}
            </span>
          </div>
        );
      })}
    </div>
  );
}

function secondaryLineFor(entry: A11yEntry): string | null {
  if (entry.role && entry.label) {
    return entry.role;
  }

  return entry.hint ?? null;
}
