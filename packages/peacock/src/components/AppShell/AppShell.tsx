import { useEffect, type CSSProperties, type ReactNode } from "react";
import { useDismissOnEscape } from "../../lib/modalStack";
import { useDragResize } from "../ResizablePanel/useDragResize";
import styles from "./AppShell.module.css";

export type ShellMode = "docked" | "overlay";

export interface AppShellProps {
  sidebar: ReactNode;
  /** The bar over the centre: history, where you are, the panel toggles. */
  toolbar?: ReactNode;
  /** The centre: whatever the route shows. */
  children: ReactNode;
  /** The side panel; null leaves the centre the whole width. */
  panel?: ReactNode;
  /** Docked beside the centre, or (narrow windows) a drawer over it. */
  sidebarMode?: ShellMode;
  sidebarOpen: boolean;
  onSidebarDismiss?: () => void;
  /** Docked on the right, or (narrow windows) a sheet over the centre. */
  panelMode?: ShellMode;
  onPanelDismiss?: () => void;
  defaultSidebarWidth?: number;
  defaultPanelWidth?: number;
  onSidebarResize?: (width: number) => void;
  onPanelResize?: (width: number) => void;
}

/**
 * Argus for Mac's main window: an inset sidebar, the centre with its
 * toolbar, and a side panel on the right. Narrow windows turn the sidebar
 * into a drawer and the panel into a sheet, as iPad and iPhone do.
 */
export function AppShell({
  sidebar,
  toolbar,
  children,
  panel,
  sidebarMode = "docked",
  sidebarOpen,
  onSidebarDismiss,
  panelMode = "docked",
  onPanelDismiss,
  defaultSidebarWidth = 272,
  defaultPanelWidth = 380,
  onSidebarResize,
  onPanelResize,
}: AppShellProps) {
  const side = useDragResize({
    axis: "horizontal",
    initialSize: defaultSidebarWidth,
    min: 240,
    max: 400,
  });
  const right = useDragResize({
    axis: "horizontal",
    initialSize: defaultPanelWidth,
    min: 300,
    max: () => Math.max(320, window.innerWidth * 0.55),
    invert: true,
  });
  useEffect(() => onSidebarResize?.(side.size), [side.size, onSidebarResize]);
  useEffect(() => onPanelResize?.(right.size), [right.size, onPanelResize]);

  const drawerUp = sidebarMode === "overlay" && sidebarOpen;
  const sheetUp = panelMode === "overlay" && panel != null;
  useDismissOnEscape(() => onSidebarDismiss?.(), drawerUp);
  useDismissOnEscape(() => onPanelDismiss?.(), sheetUp && !drawerUp);

  const widths = {
    "--shell-sidebar-width": `${side.size}px`,
    "--shell-panel-width": `${right.size}px`,
  } as CSSProperties;

  return (
    <div
      className={styles.shell}
      data-dragging={side.isDragging || right.isDragging || undefined}
      style={widths}
    >
      <aside
        className={styles.sidebar}
        data-mode={sidebarMode}
        data-open={sidebarOpen || undefined}
        inert={!sidebarOpen}
      >
        <div className={styles.sidebarCard}>{sidebar}</div>
        {sidebarMode === "docked" && sidebarOpen && (
          <div
            aria-label="Resize sidebar"
            aria-orientation="vertical"
            className={styles.sidebarHandle}
            role="separator"
            onPointerDown={side.onPointerDown}
          />
        )}
      </aside>
      {drawerUp && (
        <div aria-hidden className={styles.scrim} onClick={onSidebarDismiss} />
      )}
      <main className={styles.centre}>
        {toolbar}
        <div className={styles.content}>{children}</div>
      </main>
      {panel != null && sheetUp && (
        <div aria-hidden className={styles.scrim} onClick={onPanelDismiss} />
      )}
      {panel != null && (
        <section className={styles.panel} data-mode={panelMode}>
          {panelMode === "docked" && (
            <div
              aria-label="Resize side panel"
              aria-orientation="vertical"
              className={styles.panelHandle}
              role="separator"
              onPointerDown={right.onPointerDown}
            />
          )}
          {panel}
        </section>
      )}
    </div>
  );
}
