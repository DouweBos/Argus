import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation } from "react-router-dom";
import { useGlobalShortcuts } from "../../../hooks/useGlobalShortcuts";
import { useIpcEvent } from "../../../hooks/useIpcEvent";
import { useProjects } from "../../../hooks/useSessions";
import { useSuppressSpacePageScroll } from "../../../hooks/useSuppressSpacePageScroll";
import { useWindowFocus } from "../../../hooks/useWindowFocus";
import { startAgentInSession } from "../../../lib/agentLifecycle";
import { runCloseIntent } from "../../../lib/closeIntent";
import { closeWindow } from "../../../lib/ipc";
import {
  registerRunTerminal,
  type RunRegistrationDependency,
} from "../../../lib/runRegistration";
import { SHORTCUTS, type ShortcutId } from "../../../lib/shortcuts";
import { openHostTab } from "../../../lib/tabActions";
import { LOCAL_HOST_ID, type HostId } from "../../../lib/transport/hostId";
import { cycleActiveAgent } from "../../../stores/agentStore";
import { useAutomationsSync } from "../../../stores/automationStore";
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
import {
  setActiveCenterView,
  useActiveCenterView,
  useTrackSessionPanel,
} from "../../../stores/editorStore";
import {
  setLeftPanelWidth,
  toggleBottomPanel,
  toggleLeftSidebar,
  toggleRightPanel,
  toggleTool,
  useLeftSidebarVisible,
} from "../../../stores/layoutStore";
import { openOpenPalette } from "../../../stores/openPaletteStore";
import { useProposalsSync } from "../../../stores/proposalStore";
import { usePullRequestsSync } from "../../../stores/pullRequestStore";
import {
  getSelectedSessionId,
  getSessionState,
  selectSession,
  useSelectedSessionId,
} from "../../../stores/sessionStore";
import { showSettingsDialog } from "../../../stores/settingsStore";
import { closeActiveTab, cycleTab } from "../../../stores/tabStore";
import { useToolProjectMaskSync } from "../../../tools/projectSync";
import {
  bootstrapToolStore,
  useEffectiveToolEnabled,
} from "../../../tools/store";
import { CenterPanel } from "../../agent/CenterPanel";
import { AgentsScreen } from "../../agents/AgentsScreen";
import { AutomationsRoot } from "../../automations";
import { DevicesScreen } from "../../devices/DevicesScreen";
import { HomeScreen } from "../../home/HomeScreen";
import { NewSessionPicker } from "../../home/HomeScreen/NewSessionPicker";
import { useHomeData } from "../../home/HomeScreen/useHomeData";
import { InboxRoot } from "../../inbox";
import { NotificationsScreen } from "../../notifications";
import { PullRequestDetailScreen } from "../../pullRequests/PullRequestDetailScreen";
import { PullRequestsScreen } from "../../pullRequests/PullRequestsScreen";
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
import { ConnectionBanner } from "../ConnectionBanner";
import { ErrorBoundary } from "../ErrorBoundary";
import { PermissionBanner } from "../PermissionBanner";
import { ResizablePanel } from "../ResizablePanel";
import { TitleBar } from "../TitleBar";
import { WindowTabs } from "../WindowTabs";
import styles from "./AppShell.module.css";

const PEEK_ENTER_DELAY_MS = 200;
const PEEK_LEAVE_DELAY_MS = 500;

// Handled elsewhere on keydown (main-process close intent, window tab strip);
// AppShell keeps the handlers only so the app menu can invoke them.
const MENU_ONLY_SHORTCUTS = new Set<ShortcutId>([
  "close-tab",
  "new-tab",
  "next-tab",
  "prev-tab",
]);

// App-wide shortcuts that collide with shortcuts owned by the git panel. When
// the git panel is active these are silenced at the app layer so the GitView
// handler is the sole owner of the keypress.
//   Cmd+Shift+P   command-palette     ↔ git pull
//   Cmd+Shift+H   go-home             ↔ git show-file-history
//   Cmd+Shift+T   toggle-terminal     ↔ git new-tag
//   Cmd+Shift+A   new-agent           ↔ git amend-last / quick-actions
//   Cmd+B         toggle-left-sidebar ↔ git new-branch
const GIT_PANEL_SUPPRESSED = new Set<ShortcutId>([
  "command-palette",
  "go-home",
  "toggle-terminal",
  "new-agent",
  "toggle-left-sidebar",
]);

function renderCenter(
  selectedId: string | null,
  centerView:
    | "agents"
    | "automations"
    | "devices"
    | "home"
    | "inbox"
    | "notifications"
    | "pull-request-detail"
    | "pull-requests"
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
  if (centerView === "automations") {
    return <AutomationsRoot />;
  }
  if (centerView === "inbox") {
    return <InboxRoot />;
  }
  if (centerView === "runtimes") {
    return <RuntimeScreen />;
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
  usePullRequestsSync();
  useAutomationsSync();
  useProposalsSync();
  useTrackSessionPanel();
  useToolProjectMaskSync();
  // Reconcile the tool store against the persisted backend state once at
  // app start. Idempotent — see `bootstrapToolStore`.
  useEffect(() => {
    bootstrapToolStore();
  }, []);

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

  const recordingToolEnabled = useEffectiveToolEnabled("device-recording");
  const debugToolEnabled = useEffectiveToolEnabled("device-debug");
  const shortcutHandlers = useMemo<Record<ShortcutId, () => void>>(
    () => ({
      "command-palette": toggleCommandPalette,
      "toggle-left-sidebar": toggleLeftSidebar,
      "toggle-right-panel": toggleRightPanel,
      "toggle-bottom-panel": toggleBottomPanel,
      "toggle-terminal": () => toggleTool("terminal"),
      // Tool-gated shortcuts no-op when the tool is off — same behaviour
      // as the missing rail entry, just via the keyboard surface.
      "toggle-debug": () => {
        if (debugToolEnabled) {
          toggleTool("debug");
        }
      },
      "toggle-changes": () => toggleTool("changes"),
      "toggle-simulator": () => {
        if (recordingToolEnabled) {
          toggleTool("simulator");
        }
      },
      "open-repo": showOpenProjectDialog,
      "open-palette": openOpenPalette,
      "new-session": triggerNewSession,
      "new-agent": () => {
        startNewAgentInCurrent().catch(() => {});
      },
      settings: showSettingsDialog,
      "next-agent-tab": () => cycleAgentTab(1),
      "prev-agent-tab": () => cycleAgentTab(-1),
      "new-tab": () => {
        openHostTab(LOCAL_HOST_ID, { reuse: false }).catch(() => {});
      },
      "close-tab": () => {
        closeActiveTab();
      },
      "next-tab": () => cycleTab(1),
      "prev-tab": () => cycleTab(-1),
      "go-home": () => selectSession(null),
      "go-project-home": goToProjectHome,
    }),
    [
      startNewAgentInCurrent,
      cycleAgentTab,
      goToProjectHome,
      recordingToolEnabled,
      debugToolEnabled,
    ],
  );
  // When the git panel is active, the GitView keyboard layer owns these combos
  // (pull, file history, new tag, amend/quick-actions). Suppressing the
  // app-level handler avoids firing both behaviours on a single keypress.
  const activeCenterView = useActiveCenterView();
  const gitPanelActive = selectedId !== null && activeCenterView === "git";
  const shortcuts = useMemo(
    () =>
      (Object.keys(shortcutHandlers) as ShortcutId[])
        // Cmd+W arrives as `menu:close-intent` from the main process so views
        // get a crack at it first; registering a keydown too would close two
        // things at once. The window tab strip owns the tab combos — handlers
        // stay here for the menu, but a keydown binding would fire twice.
        .filter((id) => !MENU_ONLY_SHORTCUTS.has(id))
        .filter((id) => !gitPanelActive || !GIT_PANEL_SUPPRESSED.has(id))
        .map((id) => ({
          ...SHORTCUTS[id],
          handler: shortcutHandlers[id],
        })),
    [shortcutHandlers, gitPanelActive],
  );
  useGlobalShortcuts(shortcuts);

  useIpcEvent<{ id: ShortcutId }>("menu:invoke-shortcut", ({ id }) => {
    shortcutHandlers[id]?.();
  });

  // Cmd+W: let view-level handlers consume the intent first (e.g. the agent
  // view closes the active agent tab). Fall through to closing the window
  // when no view claims it.
  // Background-triggered runs (MCP `trigger_run`) surface in the bottom
  // terminal panel exactly like a user-pressed Run: register the tab, mark
  // it running, focus it, open the panel for the targeted session.
  useIpcEvent<{
    dependencies: RunRegistrationDependency[];
    sessionId: string;
    terminalSessionId: string;
    title: string;
  }>("run:triggered", (payload) => {
    registerRunTerminal(payload);
  });

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
    async (path: string, hostId: HostId) => {
      await openProject(path, { hostId });
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
      <WindowTabs />
      <ConnectionBanner />
      <div className={styles.body}>
        <ResizablePanel
          collapsed={!leftVisible}
          defaultWidth={280}
          maxWidth={520}
          minWidth={200}
          peeking={!leftVisible && leftPeeking}
          side="left"
          unit="pixel"
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
          <BottomPanel sessionId={selectedId} />
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
