import { useRef, useCallback, useEffect } from "react";
import { useDragResize } from "../../hooks/useDragResize";
import styles from "./ResizablePanel.module.css";

interface ResizablePanelProps {
  children: React.ReactNode;
  defaultWidth: number; // fraction of container width, e.g. 0.2
  maxWidth?: number; // fraction, e.g. 0.5
  minWidth?: number; // fraction, e.g. 0.1
  /** Called when width fraction changes (for syncing to external state) */
  onResize?: (width: number) => void;
  side: "left" | "right";
}

export function ResizablePanel({
  defaultWidth,
  minWidth = 0.1,
  maxWidth = 0.5,
  side,
  children,
  onResize,
}: ResizablePanelProps) {
  const panelRef = useRef<HTMLDivElement>(null);

  const mapDelta = useCallback(
    (delta: number) =>
      delta /
      (panelRef.current?.parentElement?.offsetWidth ?? window.innerWidth),
    [],
  );

  const { size: widthFraction, onMouseDown } = useDragResize({
    axis: "horizontal",
    initialSize: defaultWidth,
    min: minWidth,
    max: maxWidth,
    mapDelta,
    invert: side === "right",
  });

  useEffect(() => {
    onResize?.(widthFraction);
  }, [widthFraction, onResize]);

  return (
    <div
      ref={panelRef}
      className={styles.panel}
      style={{ width: `${widthFraction * 100}%` }}
    >
      <div className={styles.content}>{children}</div>
      <div
        className={`${styles.divider} ${side === "left" ? styles.right : styles.left}`}
        onMouseDown={onMouseDown}
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize panel"
      />
    </div>
  );
}
