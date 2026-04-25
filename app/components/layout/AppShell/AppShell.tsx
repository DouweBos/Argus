import { useCallback, useMemo, useRef, useState } from "react";
import { useLocation } from "react-router-dom";
import { useGlobalShortcuts } from "../../../hooks/useGlobalShortcuts";
import { useIpcEvent } from "../../../hooks/useIpcEvent";
import { useProjects } from "../../../hooks/useSessions";
import { useSuppressSpacePageScroll } from "../../../hooks/useSuppressSpacePageScroll";
import { useWindowFocus } from "../../../hooks/useWindowFocus";
import { startAgentInSession } from "../../../lib/agentLifecycle";
import { runCloseIntent } from "../../../lib/closeIntent";
import { closeWindow } from "../../../lib/ipc";
import { SHORTCUTS, type ShortcutId } from "../../../lib/shortcuts";
import { cycleActiveAgent } from "../../../stores/agentStore";
import { useCenterView } from "../../../stores/centerViewStore";
import { toggleCommandPalette } from "../../../stores/commandPaletteStore";
import {
  hideCreateSessionDialog,
  hideNewSessionPicker,
  hideOpenProjectDialog,
  showCreateSessionDialog,
  showOpenProjectDialog,
  triggerNewSession,
  useCreateSessionRepoRoot,
  useNewSessionPickerOpen,
  useOpenProjectVisible,
} from "../../../stores/dialogStore";
import { setActiveCenterView } from "../../../stores/editorStore";
import {
  setLeftPanelWidth,
  toggleBottomPanel,
  toggleLeftSidebar,
  toggleRightPanel,
  toggleTool,
  useLeftSidebarVisible,
} from "../../../stores/layoutStore";
import { openOpenPalette } from "../../../stores/openPaletteStore";
import { useOrgTaskSync } from "../../../stores/orgTaskStore";
import { usePullRequestsSync } from "../../../stores/pullRequestStore";
import {
  getSelectedSessionId,
  getSessionState,
  selectSession,
  useSelectedSessionId,
} from "../../../stores/sessionStore";
import { showSettingsDialog } from "../../../stores/settingsStore";
import { CenterPanel } from "../../agent/CenterPanel";
import { AgentsScreen } from "../../agents/AgentsScreen";
import { DevicesScreen } from "../../devices/DevicesScreen";
import { HomeScreen } from "../../home/HomeScreen";
import { NewSessionPicker } from "../../home/HomeScreen/NewSessionPicker";
import { useHomeData } from "../../home/HomeScreen/useHomeData";
import { NotificationsScreen } from "../../notifications";
import { OrganizationsScreen } from "../../organizations";
import { PullRequestDetailScreen } from "../../pullRequests/PullRequestDetailScreen";
import { PullRequestsScreen } from "../../pullRequests/PullRequestsScreen";
import { ReviewQueueScreen } from "../../reviewQueue/ReviewQueueScreen";
import { RuntimeScreen } from "../../runtimes";
import { BranchPickerDialog } from "../../shared/BranchPickerDialog";
import { CommandPalette } from "../../shared/CommandPalette";
import { OpenPalette } from "../../shared/OpenPalette";
import { SettingsDialog } from "../../shared/SettingsDialog";
import { CreateSessionDialog } from "../../sidebar/CreateSessionDialog";
import { OpenProjectDialog } from "../../sidebar/OpenProjectDialog";
import { SessionSidebar } from "../../sidebar/SessionSidebar";
import { ToolPanel } from "../../toolrail/ToolPanel";
import { ToolRail } from "../../toolrail/ToolRail";
import { BottomPanel } from "../BottomPanel";
import { ErrorBoundary } from "../ErrorBoundary";
import { PermissionBanner } from "../PermissionBanner";
import { ResizablePanel } from "../ResizablePanel";
import { TitleBar } from "../TitleBar";
import styles from "./AppShell.module.css";

const PEEK_ENTER_DELAY_MS = 200;
const PEEK_LEAVE_DELAY_MS = 1000;

function renderCenter(
  selectedId: string | null,
  centerView:
    | "agents"
    | "devices"
    | "home"
    | "notifications"
    | "organizations"
    | "pull-request-detail"
    | "pull-requests"
    | "review-queue"
    | "runtimes",
  isNotificationsRoute: boolean,
) {
  if (isNotificationsRoute) {
    return <NotificationsScreen />;
  }
  if (selectedId !== null) {
    return <CenterPanel sessionId={selectedId} />;
  }
  if (centerView === "devices") {
    return <DevicesScreen />;
  }
  if (centerView === "agents") {
    return <AgentsScreen />;
  }
  if (centerView === "runtimes") {
    return <RuntimeScreen />;
  }
  if (centerView === "organizations") {
    return <OrganizationsScreen />;
  }
  if (centerView === "review-queue") {
    return <ReviewQueueScreen />;
  }
  if (centerView === "pull-requests" || centerView === "pull-request-detail") {
    // Detail is an overlay on top of the list — the list stays mounted behind
    // so closing the detail leaves the user exactly where they were.
    return (
      <>
        <PullRequestsScreen />
        {centerView === "pull-request-detail" && <PullRequestDetailScreen />}
      </>
    );
  }

  return <HomeScreen />;
}

export function AppShell() {
  const selectedId = useSelectedSessionId();
  const centerView = useCenterView();
  const location = useLocation();
  const isNotificationsRoute =
    location.pathname.replace(/\/+$/, "") === "/notifications";
  const leftVisible = useLeftSidebarVisible();
  const setLeftWidth = setLeftPanelWidth;
  useWindowFocus();
  useSuppressSpacePageScroll();
  useOrgTaskSync();
  usePullRequestsSync();

  const startNewAgentInCurrent = useCallback(async () => {
    const id = getSelectedSessionId();
    if (!id) {
      return;
    }
    try {
      await startAgentInSession(id);
    } catch {
      // Silent — agent errors surface via the normal agent UI.
    }
  }, []);

  const cycleAgentTab = useCallback((direction: -1 | 1) => {
    const id = getSelectedSessionId();
    if (id) {
      cycleActiveAgent(id, direction);
      setActiveCenterView("agents");
    }
  }, []);

  const goToProjectHome = useCallback(() => {
    const id = getSelectedSessionId();
    const { sessions } = getSessionState();
    const current = sessions.find((w) => w.id === id);
    if (!current) {
      return;
    }
    const head = sessions.find(
      (w) => w.repo_root === current.repo_root && w.kind === "project_root",
    );
    if (head && head.id !== id) {
      selectSession(head.id);
    }
  }, []);

  const shortcutHandlers = useMemo<Record<ShortcutId, () => void>>(
    () => ({
      "command-palette": toggleCommandPalette,
      "toggle-left-sidebar": toggleLeftSidebar,
      "toggle-right-panel": toggleRightPanel,
      "toggle-bottom-panel": toggleBottomPanel,
      "toggle-terminal": () => toggleTool("terminal"),
      "toggle-debug": () => toggleTool("debug"),
      "toggle-changes": () => toggleTool("changes"),
      "toggle-simulator": () => toggleTool("simulator"),
      "open-repo": showOpenProjectDialog,
      "open-palette": openOpenPalette,
      "new-session": triggerNewSession,
      "new-agent": () => {
        startNewAgentInCurrent().catch(() => {});
      },
      settings: showSettingsDialog,
      "next-agent-tab": () => cycleAgentTab(1),
      "prev-agent-tab": () => cycleAgentTab(-1),
      "go-home": () => selectSession(null),
      "go-project-home": goToProjectHome,
    }),
    [startNewAgentInCurrent, cycleAgentTab, goToProjectHome],
  );
  const shortcuts = useMemo(
    () =>
      (Object.keys(shortcutHandlers) as ShortcutId[]).map((id) => ({
        ...SHORTCUTS[id],
        handler: shortcutHandlers[id],
      })),
    [shortcutHandlers],
  );
  useGlobalShortcuts(shortcuts);

  useIpcEvent<{ id: ShortcutId }>("menu:invoke-shortcut", ({ id }) => {
    shortcutHandlers[id]?.();
  });

  // Cmd+W: let view-level handlers consume the intent first (e.g. the agent
  // view closes the active agent tab). Fall through to closing the window
  // when no view claims it.
  useIpcEvent<undefined>("menu:close-intent", () => {
    if (runCloseIntent()) {
      return;
    }
    closeWindow().catch(() => {});
  });

  const openProjectVisible = useOpenProjectVisible();
  const newSessionPickerOpen = useNewSessionPickerOpen();
  const createSessionRepoRoot = useCreateSessionRepoRoot();
  const homeData = useHomeData();
  const { openProject } = useProjects();

  const handleOpenProjectPath = useCallback(
    async (path: string) => {
      await openProject(path);
      hideOpenProjectDialog();
    },
    [openProject],
  );

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
          <SessionSidebar />
        </ResizablePanel>

        {!leftVisible && (
          <div
            className={styles.peekZone}
            onMouseEnter={handleLeftPeekEnter}
            onMouseLeave={handleLeftPeekLeave}
          />
        )}

        <main className={styles.center}>
          <div className={styles.centerContent}>
            <ErrorBoundary>
              {renderCenter(selectedId, centerView, isNotificationsRoute)}
            </ErrorBoundary>
            <PermissionBanner />
          </div>
          {selectedId !== null && <BottomPanel sessionId={selectedId} />}
        </main>

        {selectedId !== null && <ToolPanel sessionId={selectedId} />}
        <ToolRail />
      </div>

      <CommandPalette />
      <OpenPalette />
      <SettingsDialog />
      <BranchPickerDialog />

      {openProjectVisible && (
        <OpenProjectDialog
          onClose={hideOpenProjectDialog}
          onOpen={handleOpenProjectPath}
        />
      )}

      {newSessionPickerOpen && (
        <NewSessionPicker
          projects={homeData.projects}
          onClose={hideNewSessionPicker}
          onPick={(p) => {
            hideNewSessionPicker();
            showCreateSessionDialog(p.path);
          }}
        />
      )}

      {createSessionRepoRoot && (
        <CreateSessionDialog
          repoRoot={createSessionRepoRoot}
          onClose={hideCreateSessionDialog}
        />
      )}
    </div>
  );
}
