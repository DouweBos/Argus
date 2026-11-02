/**
 * The paired-device shell, laid out as Argus for Mac: sidebar, toolbar, the
 * screen the URL names, and the side panel. Narrow windows turn the sidebar
 * into a drawer and the panel into a sheet.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import {
  AppShell,
  Banner,
  FlatIconButton,
  Icons,
  ShortcutCheatsheet,
} from "@argus/peacock";
import {
  notificationsSupported,
  requestNotificationPermission,
  setNotificationOpener,
} from "../lib/notify";
import {
  setNotificationDecider,
  startServiceWorkerRouting,
} from "../lib/webpush";
import { openAgentById } from "../routing/open";
import {
  appNavigate,
  appPath,
  navigateBack,
  stripQuery,
} from "../routing/router";
import {
  pathForScreen,
  screenPattern,
  type Screen,
  sessionOfScreen,
} from "../routing/screens";
import { useAppLocation } from "../routing/useAppLocation";
import { useConnectionStore } from "../stores/connection";
import { useDevicesStore } from "../stores/devices";
import { usePromptsStore } from "../stores/prompts";
import { setViewingSession } from "../stores/projects";
import { usePushStore } from "../stores/push";
import {
  isFallback,
  reportLaunchLink,
  reportNotificationOpen,
} from "../telemetry/links";
import { capture, captureScreen } from "../telemetry/telemetry";
import { AgentActions, AgentDock, ScreenBody } from "./MonitorPanes";
import { QuickOpenPalette, SessionToolActions } from "./SessionToolActions";
import { parentOf } from "./panes";
import { SessionHeader } from "./shell/SessionHeader";
import { loadPanelWidth, savePanelWidth, useShellPrefs } from "./shell/shellPrefs";
import { WebSidebar } from "./shell/WebSidebar";
import { WebSidePanel } from "./shell/WebSidePanel";
import { WebToolbar } from "./shell/WebToolbar";
import "./shell/shell.css";
import { TelemetryConsent } from "./TelemetryConsent";
import { loadSidebarWidth, saveSidebarWidth } from "./sidebarWidth";
import { useIsDesktop } from "./useIsWide";
import { useScrollRestore } from "./useScrollRestore";
import { useKeyboardShortcuts, WEB_SHORTCUTS } from "./useKeyboardShortcuts";
import { useViewportInset } from "./useViewportInset";

export function Monitor() {
  const { screen } = useAppLocation();
  const isDesktop = useIsDesktop();
  const connection = useConnectionStore((s) => s.connection);
  const refreshDevices = useDevicesStore((s) => s.refreshDevices);
  const pushEnabled = usePushStore((s) => s.pushEnabled);
  const setPushEnabled = usePushStore((s) => s.setPushEnabled);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [showShortcuts, setShowShortcuts] = useState(false);
  const panelOpen = useShellPrefs((s) => s.panel.open);
  const panelTab = useShellPrefs((s) => s.panel.tab);
  const setPanelOpen = useShellPrefs((s) => s.setPanelOpen);
  const sidebarShown = isDesktop ? !sidebarCollapsed : drawerOpen;
  const toggleSidebar = useCallback(
    () =>
      isDesktop ? setSidebarCollapsed((c) => !c) : setDrawerOpen((o) => !o),
    [isDesktop],
  );
  const closeDrawer = useCallback(() => setDrawerOpen(false), []);
  useEffect(() => setDrawerOpen(false), [screen]);
  const back = useCallback(() => navigateBack(parentOf(screen)), [screen]);

  // The host keeps a warm agent in the session on screen.
  const viewing =
    screen.name === "agent" ||
    screen.name === "session" ||
    screen.name === "sessionHome"
      ? screen.sessionId
      : null;
  useEffect(() => {
    if (connection === "ready") {
      setViewingSession(viewing);
    }
  }, [connection, viewing]);

  const pattern = screenPattern(screen);
  useEffect(() => captureScreen(pattern), [pattern]);
  useEffect(() => reportLaunchLink(), []);
  // A route this client doesn't have opens its parent; say so in the URL too.
  useEffect(() => {
    if (isFallback(appPath())) {
      appNavigate(screen, { replace: true });
    }
  }, [screen]);

  const toolSession = sessionOfScreen(screen);
  const [quickOpen, setQuickOpen] = useState(false);
  const closeQuickOpen = useCallback(() => setQuickOpen(false), []);

  useViewportInset();
  useKeyboardShortcuts({
    back,
    onShowShortcuts: () => setShowShortcuts(true),
    onToggleSidebar: toggleSidebar,
    onQuickOpen: toolSession ? () => setQuickOpen(true) : undefined,
    onSearchFiles: toolSession
      ? () => appNavigate({ name: "search", sessionId: toolSession })
      : undefined,
  });
  const palette = quickOpen && toolSession && (
    <QuickOpenPalette
      currentFile={screen.name === "file" ? screen.path : null}
      sessionId={toolSession}
      onClose={closeQuickOpen}
    />
  );

  // Fetched once, not polled: this only decides where the device button in an
  // agent's header goes.
  const showingAgent = screen.name === "agent";
  useEffect(() => {
    if (connection === "ready" && showingAgent) {
      void refreshDevices({ background: true }).catch(() => {});
    }
  }, [connection, refreshDevices, showingAgent]);

  // Let a notification click navigate to its agent — from this tab, or
  // forwarded by the service worker when a background push is tapped.
  useEffect(() => {
    setNotificationOpener((agentId) => {
      reportNotificationOpen();
      void openAgentById(agentId);
    });
    setNotificationDecider((agentId, toolUseId, decision) => {
      void usePromptsStore.getState().decidePrompt(agentId, toolUseId, decision);
    });
    const stopRouting = startServiceWorkerRouting();

    return () => {
      setNotificationOpener(null);
      setNotificationDecider(null);
      stopRouting();
    };
  }, []);

  // Ask for notification permission once the channel is up (desktop/Android;
  // iOS Safari needs the Settings button, which provides a user gesture).
  // Permission gates the push subscription, so re-run registration after.
  useEffect(() => {
    if (
      connection === "ready" &&
      notificationsSupported() &&
      Notification.permission === "default"
    ) {
      void requestNotificationPermission().then(() =>
        setPushEnabled(pushEnabled),
      );
    }
  }, [connection, pushEnabled, setPushEnabled]);

  // A notification actioned with no tab open launches us at `?agent=…`, and an
  // Approve/Deny adds `?decide=…&tool=…`. Replay it, then drop the params so a
  // reload doesn't do it twice.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const agentId = params.get("agent");
    if (!agentId) {
      return;
    }
    const decision = params.get("decide");
    const toolUseId = params.get("tool");
    stripQuery("agent", "decide", "tool");
    if ((decision === "allow" || decision === "deny") && toolUseId) {
      void usePromptsStore.getState().decidePrompt(agentId, toolUseId, decision);

      return;
    }
    void openAgentById(agentId);
  }, []);

  const offlineBanner = connection === "offline" && (
    <Banner tone="warning">
      Lost the connection to Argus — retrying automatically.
    </Banner>
  );

  const onResize = useCallback((w: number) => saveSidebarWidth(w), []);

  const onPanelResize = useCallback((w: number) => savePanelWidth(w), []);
  const panelShown = panelOpen;
  const togglePanel = () => {
    capture("web_side_panel_toggled", { open: !panelShown, tab: panelTab });
    setPanelOpen(!panelShown);
  };
  const agentId = screen.name === "agent" ? screen.agentId : null;

  return (
    <div className="aw-window">
      <AppShell
        defaultPanelWidth={loadPanelWidth()}
        defaultSidebarWidth={loadSidebarWidth()}
        panel={panelShown ? <WebSidePanel sessionId={toolSession} /> : null}
        panelMode={isDesktop ? "docked" : "overlay"}
        sidebar={<WebSidebar screen={screen} onNavigate={closeDrawer} />}
        sidebarMode={isDesktop ? "docked" : "overlay"}
        sidebarOpen={sidebarShown}
        toolbar={
          <WebToolbar
            leading={
              <FlatIconButton
                icon={<Icons.LeftSidebarIcon size={15} />}
                label={sidebarShown ? "Hide sidebar" : "Show sidebar"}
                onClick={toggleSidebar}
              />
            }
            screen={screen}
            trailing={
              <>
                <SessionToolActions screen={screen} />
                {agentId && (
                  <AgentActions agentId={agentId} onStopped={back} />
                )}
                <FlatIconButton
                  icon={<Icons.RightSidebarIcon size={15} />}
                  label={panelShown ? "Hide side panel" : "Show side panel"}
                  selected={panelShown}
                  onClick={togglePanel}
                />
              </>
            }
          />
        }
        onPanelDismiss={() => setPanelOpen(false)}
        onPanelResize={onPanelResize}
        onSidebarDismiss={closeDrawer}
        onSidebarResize={onResize}
      >
        {offlineBanner && <div className="aw-window-banner">{offlineBanner}</div>}
        {toolSession && <SessionHeader screen={screen} sessionId={toolSession} />}
        <ScreenFrame screen={screen} />
        {agentId && <AgentDock agentId={agentId} />}
      </AppShell>
      {palette}
      <TelemetryConsent />
      <ShortcutCheatsheet
        open={showShortcuts}
        scope="session"
        shortcuts={WEB_SHORTCUTS}
        onClose={() => setShowShortcuts(false)}
      />
    </div>
  );
}

/** The centre's scrolling body; it remembers where each screen was scrolled to. */
function ScreenFrame({ screen }: { screen: Screen }) {
  const mainRef = useRef<HTMLDivElement>(null);
  useScrollRestore(mainRef, pathForScreen(screen), screen.name !== "agent");

  return (
    <div
      className="aw-main"
      data-screen={screen.name}
      ref={mainRef}
    >
      <ScreenBody screen={screen} />
    </div>
  );
}
