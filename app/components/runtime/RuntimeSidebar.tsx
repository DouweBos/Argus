import { useRef, useCallback } from "react";
import { MergeBar } from "./MergeBar";
import { TerminalTabs } from "./TerminalTabs";
import { SimulatorView } from "./SimulatorView";
import { useDragResize } from "../../hooks/useDragResize";
import styles from "./RuntimeSidebar.module.css";

interface RuntimeSidebarProps {
  workspaceId: null | string;
}

const MIN_SIM_HEIGHT = 120;
const MIN_TERMINAL_HEIGHT = 80;

export function RuntimeSidebar({ workspaceId }: RuntimeSidebarProps) {
  const sidebarRef = useRef<HTMLDivElement>(null);

  const getMax = useCallback(
    () => (sidebarRef.current?.clientHeight ?? 600) - MIN_TERMINAL_HEIGHT,
    [],
  );

  const { size: simHeight, onMouseDown } = useDragResize({
    axis: "vertical",
    initialSize:
      typeof window !== "undefined" ? Math.floor(window.innerHeight / 2) : 400,
    min: MIN_SIM_HEIGHT,
    max: getMax,
    invert: true,
  });

  return (
    <div className={styles.sidebar} ref={sidebarRef}>
      <MergeBar workspaceId={workspaceId} />
      {/* Terminals section: keep TerminalTabs mounted per workspace to preserve output when switching */}
      <div className={styles.terminalSection}>
        <div className={styles.sectionHeader}>
          <span className={styles.sectionLabel}>Terminals</span>
        </div>
        {workspaceId ? (
          <TerminalTabs workspaceId={workspaceId} />
        ) : (
          <div className={styles.noWorkspace}>
            <p>Select a workspace to open terminals.</p>
          </div>
        )}
      </div>

      {/* Drag divider */}
      <div
        className={styles.hDivider}
        onMouseDown={onMouseDown}
        role="separator"
        aria-orientation="horizontal"
        aria-label="Resize simulator"
      />

      {/* Simulator section */}
      <div className={styles.simulatorSection} style={{ height: simHeight }}>
        <SimulatorView workspaceId={workspaceId} />
      </div>
    </div>
  );
}
