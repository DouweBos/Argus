import { useRef, useState, useCallback } from "react";
import { ResizablePanel } from "./ResizablePanel";
import { TitleBar } from "./TitleBar";
import { ErrorBoundary } from "./ErrorBoundary";
import { WorkspaceSidebar } from "../sidebar/WorkspaceSidebar";
import { AgentPanel } from "../agent/AgentPanel";
import { HomeScreen } from "../home/HomeScreen";
import { RuntimeSidebar } from "../runtime/RuntimeSidebar";
import { useWorkspaceStore } from "../../stores/workspaceStore";
import { useLayoutStore } from "../../stores/layoutStore";
import { useWindowFocus } from "../../hooks/useWindowFocus";
import styles from "./AppShell.module.css";

const PEEK_ENTER_DELAY_MS = 200;
const PEEK_LEAVE_DELAY_MS = 1000;

export function AppShell() {
  const selectedId = useWorkspaceStore((s) => s.selectedId);
  const leftVisible = useLayoutStore((s) => s.leftSidebarVisible);
  const rightVisible = useLayoutStore((s) => s.rightSidebarVisible);
  const setLeftWidth = useLayoutStore((s) => s.setLeftPanelWidth);
  const setRightWidth = useLayoutStore((s) => s.setRightPanelWidth);
  useWindowFocus();

  // Peek overlay state
  const [leftPeeking, setLeftPeeking] = useState(false);
  const [rightPeeking, setRightPeeking] = useState(false);
  const leftTimerRef = useRef<null | ReturnType<typeof setTimeout>>(null);
  const rightTimerRef = useRef<null | ReturnType<typeof setTimeout>>(null);

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

  const handleRightPeekEnter = useCallback(() => {
    if (rightTimerRef.current) clearTimeout(rightTimerRef.current);
    rightTimerRef.current = setTimeout(
      () => setRightPeeking(true),
      PEEK_ENTER_DELAY_MS,
    );
  }, []);

  const handleRightPeekLeave = useCallback(() => {
    if (rightTimerRef.current) clearTimeout(rightTimerRef.current);
    rightTimerRef.current = setTimeout(
      () => setRightPeeking(false),
      PEEK_LEAVE_DELAY_MS,
    );
  }, []);

  return (
    <div className={styles.shell}>
      <TitleBar />
      <div className={styles.body}>
        {leftVisible ? (
          <ResizablePanel
            defaultWidth={0.18}
            minWidth={0.1}
            maxWidth={0.35}
            side="left"
            onResize={setLeftWidth}
          >
            <WorkspaceSidebar />
          </ResizablePanel>
        ) : (
          <div
            className={styles.peekZone}
            onMouseEnter={handleLeftPeekEnter}
            onMouseLeave={handleLeftPeekLeave}
          >
            <div
              className={`${styles.peekOverlay} ${styles.peekOverlayLeft}`}
              data-visible={leftPeeking}
            >
              {leftPeeking && <WorkspaceSidebar />}
            </div>
          </div>
        )}

        <main className={styles.center}>
          <ErrorBoundary>
            {selectedId === null ? (
              <HomeScreen />
            ) : (
              <AgentPanel workspaceId={selectedId} />
            )}
          </ErrorBoundary>
        </main>

        {rightVisible ? (
          <ResizablePanel
            defaultWidth={0.35}
            minWidth={0.15}
            maxWidth={0.6}
            side="right"
            onResize={setRightWidth}
          >
            <RuntimeSidebar workspaceId={selectedId} />
          </ResizablePanel>
        ) : (
          <div
            className={`${styles.peekZone} ${styles.peekZoneRight}`}
            onMouseEnter={handleRightPeekEnter}
            onMouseLeave={handleRightPeekLeave}
          >
            <div
              className={`${styles.peekOverlay} ${styles.peekOverlayRight}`}
              data-visible={rightPeeking}
            >
              {rightPeeking && <RuntimeSidebar workspaceId={selectedId} />}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
