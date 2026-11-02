/**
 * The paired-device shell. The URL names one screen. Narrow screens show just
 * that; from tablet width up the master and detail panes sit side by side, so
 * an agent opens next to its project rather than over it.
 */

import { useCallback, useEffect, useState } from "react";
import {
  Banner,
  EmptyState,
  Icons,
  ShortcutCheatsheet,
  SplitShell,
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
  paneFor,
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
import { captureScreen } from "../telemetry/telemetry";
import { DetailPane, MasterPane, SinglePane } from "./MonitorPanes";
import { QuickOpenPalette } from "./SessionToolActions";
import { parentOf, useMasterScreen } from "./panes";
import { TelemetryConsent } from "./TelemetryConsent";
import { loadSidebarWidth, saveSidebarWidth } from "./sidebarWidth";
import { useIsWide } from "./useIsWide";
import { useKeyboardShortcuts, WEB_SHORTCUTS } from "./useKeyboardShortcuts";
import { useViewportInset } from "./useViewportInset";

export function Monitor() {
  const { screen } = useAppLocation();
  const isWide = useIsWide();
  const connection = useConnectionStore((s) => s.connection);
  const refreshDevices = useDevicesStore((s) => s.refreshDevices);
  const pushEnabled = usePushStore((s) => s.pushEnabled);
  const setPushEnabled = usePushStore((s) => s.setPushEnabled);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [showShortcuts, setShowShortcuts] = useState(false);
  const master = useMasterScreen(screen);
  const detail = paneFor(screen) === "detail" ? screen : null;
  // Browsing the master pane while a detail is open moves the pane alone:
  // the URL keeps naming what is open on the right.
  const [masterOverride, setMasterOverride] = useState<Screen | null>(null);
  useEffect(() => setMasterOverride(null), [screen]);
  const goMaster = useCallback(
    (next: Screen) => (detail ? setMasterOverride(next) : appNavigate(next)),
    [detail],
  );
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
    onToggleSidebar: isWide
      ? () => setSidebarCollapsed((c) => !c)
      : undefined,
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

  if (!isWide) {
    return (
      <div className="aw-shell">
        <SinglePane banner={offlineBanner} onBack={back} screen={screen} />
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

  return (
    <div className="aw-shell aw-shell-wide">
      <SplitShell
        collapsed={sidebarCollapsed}
        defaultSidebarWidth={loadSidebarWidth()}
        maxSidebarWidth={520}
        minSidebarWidth={240}
        onSidebarResize={onResize}
        sidebar={
          <MasterPane
            banner={offlineBanner}
            goMaster={goMaster}
            screen={masterOverride ?? master}
          />
        }
      >
        {detail ? (
          <DetailPane onClose={() => appNavigate(master)} screen={detail} />
        ) : (
          <div className="aw-pane">
            <div className="aw-main aw-empty-detail">
              <EmptyState
                icon={<Icons.ArgusLogo size={28} />}
                title="Nothing open"
                body="Pick an agent or a device from the list to bring it up here."
              />
            </div>
          </div>
        )}
      </SplitShell>
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
