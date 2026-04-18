import { useCallback, useMemo, useRef, useState } from "react";
import { useGlobalShortcuts } from "../../../hooks/useGlobalShortcuts";
import { useIpcEvent } from "../../../hooks/useIpcEvent";
import { useSuppressSpacePageScroll } from "../../../hooks/useSuppressSpacePageScroll";
import { useWindowFocus } from "../../../hooks/useWindowFocus";
import { useProjects } from "../../../hooks/useWorkspaces";
import { stopAgentById } from "../../../lib/agentEventService";
import { closeWindow, startAgent } from "../../../lib/ipc";
import {
  addAgent,
  cycleActiveAgent,
  getAgentState,
} from "../../../stores/agentStore";
import { useCenterView } from "../../../stores/centerViewStore";
import { toggleCommandPalette } from "../../../stores/commandPaletteStore";
import {
  hideCreateWorkspaceDialog,
  hideNewWorkspacePicker,
  hideOpenProjectDialog,
  showCreateWorkspaceDialog,
  showOpenProjectDialog,
  triggerNewWorkspace,
  useCreateWorkspaceRepoRoot,
  useNewWorkspacePickerOpen,
  useOpenProjectVisible,
} from "../../../stores/dialogStore";
import {
  setLeftPanelWidth,
  toggleLeftSidebar,
  toggleRightPanel,
  useLeftSidebarVisible,
} from "../../../stores/layoutStore";
import { showSettingsDialog } from "../../../stores/settingsStore";
import {
  getWorkspaceState,
  selectWorkspace,
  useSelectedWorkspaceId,
} from "../../../stores/workspaceStore";
import { ActivityScreen } from "../../activity/ActivityScreen";
import { CenterPanel } from "../../agent/CenterPanel";
import { AgentsScreen } from "../../agents/AgentsScreen";
import { DevicesScreen } from "../../devices/DevicesScreen";
import { HomeScreen } from "../../home/HomeScreen";
import { NewWorkspacePicker } from "../../home/HomeScreen/NewWorkspacePicker";
import { useHomeData } from "../../home/HomeScreen/useHomeData";
import { ReviewQueueScreen } from "../../reviewQueue/ReviewQueueScreen";
import { BranchPickerDialog } from "../../shared/BranchPickerDialog";
import { CommandPalette } from "../../shared/CommandPalette";
import { SettingsDialog } from "../../shared/SettingsDialog";
import { CreateWorkspaceDialog } from "../../sidebar/CreateWorkspaceDialog";
import { OpenProjectDialog } from "../../sidebar/OpenProjectDialog";
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

function renderCenter(
  selectedId: string | null,
  centerView: "activity" | "agents" | "devices" | "home" | "review-queue",
) {
  if (selectedId !== null) {
    return <CenterPanel workspaceId={selectedId} />;
  }
  if (centerView === "devices") {
    return <DevicesScreen />;
  }
  if (centerView === "agents") {
    return <AgentsScreen />;
  }
  if (centerView === "review-queue") {
    return <ReviewQueueScreen />;
  }
  if (centerView === "activity") {
    return <ActivityScreen />;
  }

  return <HomeScreen />;
}

export function AppShell() {
  const selectedId = useSelectedWorkspaceId();
  const centerView = useCenterView();
  const leftVisible = useLeftSidebarVisible();
  const setLeftWidth = setLeftPanelWidth;
  useWindowFocus();
  useSuppressSpacePageScroll();

  const startNewAgentInCurrent = useCallback(async () => {
    const { selectedId: id } = getWorkspaceState();
    if (!id) {
      return;
    }
    try {
      const info = await startAgent(id);
      addAgent({
        agent_id: info.agent_id,
        workspace_id: info.workspace_id,
        status: "running",
      });
    } catch {
      // Silent — agent errors surface via the normal agent UI.
    }
  }, []);

  const cycleAgentTab = useCallback((direction: -1 | 1) => {
    const { selectedId: id } = getWorkspaceState();
    if (id) {
      cycleActiveAgent(id, direction);
    }
  }, []);

  const goToProjectHome = useCallback(() => {
    const { selectedId: id, workspaces } = getWorkspaceState();
    const current = workspaces.find((w) => w.id === id);
    if (!current) {
      return;
    }
    const head = workspaces.find(
      (w) => w.repo_root === current.repo_root && w.kind === "repo_root",
    );
    if (head && head.id !== id) {
      selectWorkspace(head.id);
    }
  }, []);

  const shortcuts = useMemo(
    () => [
      { meta: true, key: "k", handler: toggleCommandPalette },
      { meta: true, key: "b", handler: toggleLeftSidebar },
      { meta: true, alt: true, key: "b", handler: toggleRightPanel },
      { meta: true, key: "o", handler: showOpenProjectDialog },
      { meta: true, key: "n", handler: triggerNewWorkspace },
      {
        meta: true,
        shift: true,
        key: "a",
        handler: () => {
          startNewAgentInCurrent().catch(() => {});
        },
      },
      { meta: true, key: ",", handler: showSettingsDialog },
      {
        meta: true,
        shift: true,
        key: "]",
        handler: () => cycleAgentTab(1),
      },
      {
        meta: true,
        shift: true,
        key: "[",
        handler: () => cycleAgentTab(-1),
      },
      {
        meta: true,
        shift: true,
        key: "h",
        handler: () => selectWorkspace(null),
      },
      {
        meta: true,
        alt: true,
        key: "h",
        handler: goToProjectHome,
      },
    ],
    [startNewAgentInCurrent, cycleAgentTab, goToProjectHome],
  );
  useGlobalShortcuts(shortcuts);

  // Cmd+W: close the active agent tab in the selected workspace first. Only
  // fall through to closing the window when no agent is open.
  useIpcEvent<undefined>("menu:close-intent", () => {
    const { selectedId: id } = getWorkspaceState();
    const { agents, activeAgentId } = getAgentState();
    const activeId = id ? activeAgentId[id] : null;
    if (activeId && agents[activeId]) {
      stopAgentById(activeId).catch(() => {});

      return;
    }
    closeWindow().catch(() => {});
  });

  const openProjectVisible = useOpenProjectVisible();
  const newWorkspacePickerOpen = useNewWorkspacePickerOpen();
  const createWorkspaceRepoRoot = useCreateWorkspaceRepoRoot();
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
          <ErrorBoundary>{renderCenter(selectedId, centerView)}</ErrorBoundary>
          <PermissionBanner />
        </main>

        {selectedId !== null && (
          <>
            <ToolPanel workspaceId={selectedId} />
            <ToolRail />
          </>
        )}
      </div>

      <CommandPalette />
      <SettingsDialog />
      <BranchPickerDialog />

      {openProjectVisible && (
        <OpenProjectDialog
          onClose={hideOpenProjectDialog}
          onOpen={handleOpenProjectPath}
        />
      )}

      {newWorkspacePickerOpen && (
        <NewWorkspacePicker
          projects={homeData.projects}
          onClose={hideNewWorkspacePicker}
          onPick={(p) => {
            hideNewWorkspacePicker();
            showCreateWorkspaceDialog(p.path);
          }}
        />
      )}

      {createWorkspaceRepoRoot && (
        <CreateWorkspaceDialog
          repoRoot={createWorkspaceRepoRoot}
          onClose={hideCreateWorkspaceDialog}
        />
      )}
    </div>
  );
}
