import { useRef, useState, useCallback } from "react";
import { ResizablePanel } from "./ResizablePanel";
import { TitleBar } from "./TitleBar";
import { ErrorBoundary } from "./ErrorBoundary";
import { WorkspaceSidebar } from "../sidebar/WorkspaceSidebar";
import { CenterPanel } from "../agent/CenterPanel";
import { HomeScreen } from "../home/HomeScreen";
import { ToolPanel } from "../toolrail/ToolPanel";
import { ToolRail } from "../toolrail/ToolRail";
import { useWorkspaceStore } from "../../stores/workspaceStore";
import { useLayoutStore } from "../../stores/layoutStore";
import { useWindowFocus } from "../../hooks/useWindowFocus";
import styles from "./AppShell.module.css";

const PEEK_ENTER_DELAY_MS = 200;
const PEEK_LEAVE_DELAY_MS = 1000;

export function AppShell() {
  const selectedId = useWorkspaceStore((s) => s.selectedId);
  const leftVisible = useLayoutStore((s) => s.leftSidebarVisible);
  const setLeftWidth = useLayoutStore((s) => s.setLeftPanelWidth);
  useWindowFocus();

  // Left peek overlay state
  const [leftPeeking, setLeftPeeking] = useState(false);
  const leftTimerRef = useRef<null | ReturnType<typeof setTimeout>>(null);

  const handleLeftPeekEnter = useCallback(() => {
    if (leftTimerRef.current) clearTimeout(leftTimerRef.current);
    leftTimerRef.current = setTimeout(
      () => setLeftPeeking(true),
      PEEK_ENTER_DELAY_MS,
    );
  }, []);

  const handleLeftPeekLeave = useCallback(() => {
    if (leftTimerRef.current) clearTimeout(leftTimerRef.current);
    leftTimerRef.current = setTimeout(
      () => setLeftPeeking(false),
      PEEK_LEAVE_DELAY_MS,
    );
  }, []);

  return (
    <div className={styles.shell}>
      <TitleBar />
      <div className={styles.body}>
        <ResizablePanel
          collapsed={!leftVisible}
          peeking={!leftVisible && leftPeeking}
          defaultWidth={0.18}
          minWidth={0.1}
          maxWidth={0.35}
          side="left"
          onResize={setLeftWidth}
          onMouseEnter={!leftVisible ? handleLeftPeekEnter : undefined}
          onMouseLeave={!leftVisible ? handleLeftPeekLeave : undefined}
        >
          <WorkspaceSidebar />
        </ResizablePanel>

        {!leftVisible && (
          <div
            className={styles.peekZone}
            onMouseEnter={handleLeftPeekEnter}
            onMouseLeave={handleLeftPeekLeave}
          />
        )}

        <main className={styles.center}>
          <ErrorBoundary>
            {selectedId === null ? (
              <HomeScreen />
            ) : (
              <CenterPanel workspaceId={selectedId} />
            )}
          </ErrorBoundary>
        </main>

        {selectedId !== null && (
          <>
            <ToolPanel workspaceId={selectedId} />
            <ToolRail />
          </>
        )}
      </div>
    </div>
  );
}
