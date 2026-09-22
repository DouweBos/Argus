import { useCallback, useEffect, useState } from "react";
import { useDragResize } from "../ResizablePanel/useDragResize";
import styles from "./SplitShell.module.css";

interface SplitShellProps {
  /** Main pane content. */
  children: React.ReactNode;
  /** Slide the sidebar away without unmounting it. */
  collapsed?: boolean;
  defaultSidebarWidth?: number;
  maxSidebarWidth?: number;
  minSidebarWidth?: number;
  /** Fired on every drag frame so the host can persist the width. */
  onSidebarResize?: (width: number) => void;
  sidebar: React.ReactNode;
}

/**
 * Two-pane master/detail shell with a drag-resizable sidebar. Presentational
 * only — the host decides what goes in each pane and when to collapse.
 */
export function SplitShell({
  sidebar,
  children,
  collapsed = false,
  defaultSidebarWidth = 300,
  minSidebarWidth = 220,
  maxSidebarWidth = 520,
  onSidebarResize,
}: SplitShellProps) {
  const { size: width, onPointerDown } = useDragResize({
    axis: "horizontal",
    initialSize: defaultSidebarWidth,
    min: minSidebarWidth,
    max: maxSidebarWidth,
  });

  const [isDragging, setIsDragging] = useState(false);
  const handlePointerDown = useCallback(
    (e: React.PointerEvent) => {
      setIsDragging(true);
      onPointerDown(e);
    },
    [onPointerDown],
  );
  useEffect(() => {
    if (!isDragging) {
      return;
    }
    const stop = () => setIsDragging(false);
    window.addEventListener("pointerup", stop);
    window.addEventListener("pointercancel", stop);

    return () => {
      window.removeEventListener("pointerup", stop);
      window.removeEventListener("pointercancel", stop);
    };
  }, [isDragging]);

  useEffect(() => {
    onSidebarResize?.(width);
  }, [width, onSidebarResize]);

  return (
    <div className={styles.shell} data-dragging={isDragging}>
      <aside
        className={styles.sidebar}
        data-collapsed={collapsed}
        style={{ width: `${width}px`, flex: "0 0 auto" }}
      >
        <div className={styles.sidebarContent}>{sidebar}</div>
        {!collapsed && (
          <div
            aria-label="Resize sidebar"
            aria-orientation="vertical"
            className={styles.divider}
            role="separator"
            onPointerDown={handlePointerDown}
          />
        )}
      </aside>
      <main className={styles.detail}>{children}</main>
    </div>
  );
}
