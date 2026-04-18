import { useCallback, useMemo, useRef, useState } from "react";
import { useGlobalShortcuts } from "../../../hooks/useGlobalShortcuts";
import { useSuppressSpacePageScroll } from "../../../hooks/useSuppressSpacePageScroll";
import { useWindowFocus } from "../../../hooks/useWindowFocus";
import { toggleCommandPalette } from "../../../stores/commandPaletteStore";
import {
  setLeftPanelWidth,
  toggleLeftSidebar,
  toggleRightPanel,
  useLeftSidebarVisible,
} from "../../../stores/layoutStore";
import { useSelectedWorkspaceId } from "../../../stores/workspaceStore";
import { CenterPanel } from "../../agent/CenterPanel";
import { HomeScreen } from "../../home/HomeScreen";
import { WorkspaceSidebar } from "../../sidebar/WorkspaceSidebar";
import { ToolPanel } from "../../toolrail/ToolPanel";
import { ToolRail } from "../../toolrail/ToolRail";
import { ErrorBoundary } from "../ErrorBoundary";
import { PermissionBanner } from "../PermissionBanner";
import { ResizablePanel } from "../ResizablePanel";
import { TitleBar } from "../TitleBar";
import styles from "./AppShell.module.css";

const PEEK_ENTER_DELAY_MS = 200;
const PEEK_LEAVE_DELAY_MS = 1000;

export function AppShell() {
  const selectedId = useSelectedWorkspaceId();
  const leftVisible = useLeftSidebarVisible();
  const setLeftWidth = setLeftPanelWidth;
  useWindowFocus();
  useSuppressSpacePageScroll();

  const shortcuts = useMemo(
    () => [
      { meta: true, key: "k", handler: toggleCommandPalette },
      { meta: true, key: "b", handler: toggleLeftSidebar },
      { meta: true, alt: true, key: "b", handler: toggleRightPanel },
    ],
    [],
  );
  useGlobalShortcuts(shortcuts);

  // Left peek overlay state
  const [leftPeeking, setLeftPeeking] = useState(false);
  const leftTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleLeftPeekEnter = useCallback(() => {
    if (leftTimerRef.current) {
      clearTimeout(leftTimerRef.current);
    }
    leftTimerRef.current = setTimeout(
      () => setLeftPeeking(true),
      PEEK_ENTER_DELAY_MS,
    );
  }, []);

  const handleLeftPeekLeave = useCallback(() => {
    if (leftTimerRef.current) {
      clearTimeout(leftTimerRef.current);
    }
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
          defaultWidth={0.18}
          maxWidth={0.35}
          minWidth={0.1}
          peeking={!leftVisible && leftPeeking}
          side="left"
          onMouseEnter={!leftVisible ? handleLeftPeekEnter : undefined}
          onMouseLeave={!leftVisible ? handleLeftPeekLeave : undefined}
          onResize={setLeftWidth}
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

        <PermissionBanner />
      </div>
    </div>
  );
}
