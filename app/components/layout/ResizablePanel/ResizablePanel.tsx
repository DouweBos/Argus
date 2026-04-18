import { useCallback, useEffect, useRef, useState } from "react";
import { useDragResize } from "../../../hooks/useDragResize";
import styles from "./ResizablePanel.module.css";

interface ResizablePanelProps {
  children: React.ReactNode;
  /** Animate panel off-screen — stays in DOM but slides out via margin + transform */
  collapsed?: boolean;
  defaultWidth: number; // fraction of container width, e.g. 0.2
  maxWidth?: number; // fraction, e.g. 0.5
  minWidth?: number; // fraction, e.g. 0.1
  onMouseEnter?: React.MouseEventHandler;
  onMouseLeave?: React.MouseEventHandler;
  /** Called when width fraction changes (for syncing to external state) */
  onResize?: (width: number) => void;
  /** Show the collapsed panel as a floating overlay (keeps negative margin, removes transform) */
  peeking?: boolean;
  side: "left" | "right";
}

export function ResizablePanel({
  collapsed = false,
  defaultWidth,
  minWidth = 0.1,
  maxWidth = 0.5,
  side,
  children,
  onResize,
  onMouseEnter,
  onMouseLeave,
  peeking = false,
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

  // Track drag state to disable CSS transitions during resize
  const [isDragging, setIsDragging] = useState(false);
  const handleDividerMouseDown = useCallback(
    (e: React.MouseEvent) => {
      setIsDragging(true);
      onMouseDown(e);
    },
    [onMouseDown],
  );
  useEffect(() => {
    if (!isDragging) {
      return;
    }
    const handleMouseUp = () => setIsDragging(false);
    window.addEventListener("mouseup", handleMouseUp);

    return () => window.removeEventListener("mouseup", handleMouseUp);
  }, [isDragging]);

  useEffect(() => {
    onResize?.(widthFraction);
  }, [widthFraction, onResize]);

  const widthPercent = `${widthFraction * 100}%`;
  const marginProp = side === "left" ? "marginLeft" : "marginRight";
  const hiddenOffset = side === "left" ? "-100%" : "100%";
  const peekOffset = side === "left" ? "100%" : "-100%";

  let transform = "none";
  if (collapsed && peeking) {
    transform = `translateX(${peekOffset})`;
  } else if (collapsed) {
    transform = `translateX(${hiddenOffset})`;
  }

  return (
    <div
      ref={panelRef}
      className={styles.panel}
      data-collapsed={collapsed}
      data-dragging={isDragging}
      data-peeking={peeking}
      style={{
        width: widthPercent,
        [marginProp]: collapsed ? `-${widthFraction * 100}%` : "0",
        transform,
      }}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
    >
      <div className={styles.content}>{children}</div>
      {!collapsed && (
        <div
          aria-label="Resize panel"
          aria-orientation="vertical"
          className={`${styles.divider} ${side === "left" ? styles.right : styles.left}`}
          role="separator"
          onMouseDown={handleDividerMouseDown}
        />
      )}
    </div>
  );
}
