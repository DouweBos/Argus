import { useCallback, useEffect, useRef, useState } from "react";
import { useDragResize } from "../../../hooks/useDragResize";
import styles from "./ResizablePanel.module.css";

export type PanelSide = "bottom" | "left" | "right";

interface ResizablePanelProps {
  children: React.ReactNode;
  /** Animate panel off-screen — stays in DOM but slides out via margin + transform. Left/right only. */
  collapsed?: boolean;
  /** Initial size fraction (width for left/right; height for bottom). */
  defaultWidth: number;
  maxWidth?: number;
  minWidth?: number;
  /** Suppress open/close transitions for the next commit. */
  noAnimate?: boolean;
  onMouseEnter?: React.MouseEventHandler;
  onMouseLeave?: React.MouseEventHandler;
  /** Called when size fraction changes (for syncing to external state) */
  onResize?: (size: number) => void;
  /** Show the collapsed panel as a floating overlay (left/right peek). */
  peeking?: boolean;
  side: PanelSide;
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
  noAnimate = false,
}: ResizablePanelProps) {
  const panelRef = useRef<HTMLDivElement>(null);

  const isVertical = side === "bottom";

  const mapDelta = useCallback(
    (delta: number) => {
      const parent = panelRef.current?.parentElement;
      if (isVertical) {
        return delta / (parent?.offsetHeight ?? window.innerHeight);
      }

      return delta / (parent?.offsetWidth ?? window.innerWidth);
    },
    [isVertical],
  );

  const { size: sizeFraction, onMouseDown } = useDragResize({
    axis: isVertical ? "vertical" : "horizontal",
    initialSize: defaultWidth,
    min: minWidth,
    max: maxWidth,
    mapDelta,
    invert: side === "right" || side === "bottom",
  });

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
    onResize?.(sizeFraction);
  }, [sizeFraction, onResize]);

  const sizePercent = `${sizeFraction * 100}%`;

  let transform = "none";
  if (collapsed && peeking && !isVertical) {
    const peekOffset = side === "left" ? "100%" : "-100%";
    transform = `translateX(${peekOffset})`;
  } else if (collapsed && side === "left") {
    transform = "translateX(-100%)";
  } else if (collapsed && side === "right") {
    transform = "translateX(100%)";
  }

  const style: React.CSSProperties = { transform };
  if (isVertical) {
    style.height = sizePercent;
  } else {
    style.width = sizePercent;
    const marginProp = side === "left" ? "marginLeft" : "marginRight";
    style[marginProp] = collapsed ? `-${sizeFraction * 100}%` : "0";
  }

  let dividerSideClass = styles.right;
  if (side === "left") {
    dividerSideClass = styles.right;
  } else if (side === "right") {
    dividerSideClass = styles.left;
  } else {
    dividerSideClass = styles.top;
  }

  return (
    <div
      ref={panelRef}
      className={styles.panel}
      data-collapsed={collapsed}
      data-dragging={isDragging}
      data-no-animate={noAnimate}
      data-peeking={peeking}
      data-side={side}
      style={style}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
    >
      <div className={styles.content}>{children}</div>
      {!collapsed && (
        <div
          aria-label="Resize panel"
          aria-orientation={isVertical ? "horizontal" : "vertical"}
          className={`${styles.divider} ${dividerSideClass}`}
          role="separator"
          onMouseDown={handleDividerMouseDown}
        />
      )}
    </div>
  );
}
