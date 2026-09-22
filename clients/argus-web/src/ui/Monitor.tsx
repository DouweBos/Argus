/**
 * The paired-device shell. Narrow screens show one view at a time (the top of
 * the history stack); from tablet width up the master and detail panes sit side
 * by side, so picking an agent leaves the project list on screen.
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
import { useAppStore } from "../lib/store";
import { DetailPane, MasterPane, SinglePane } from "./MonitorPanes";
import { loadSidebarWidth, saveSidebarWidth } from "./sidebarWidth";
import { useHistoryView } from "./useHistoryView";
import { useIsWide } from "./useIsWide";
import { useKeyboardShortcuts, WEB_SHORTCUTS } from "./useKeyboardShortcuts";
import { useViewportInset } from "./useViewportInset";

export function Monitor() {
  const { view, masterView, detailView, push, back, canGoBack } =
    useHistoryView();
  const isWide = useIsWide();
  const connection = useAppStore((s) => s.connection);
  const refreshDevices = useAppStore((s) => s.refreshDevices);
  const pushEnabled = useAppStore((s) => s.pushEnabled);
  const setPushEnabled = useAppStore((s) => s.setPushEnabled);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [showShortcuts, setShowShortcuts] = useState(false);

  useViewportInset();
  useKeyboardShortcuts({
    back,
    onShowShortcuts: () => setShowShortcuts(true),
    onToggleSidebar: isWide
      ? () => setSidebarCollapsed((c) => !c)
      : undefined,
  });

  // Fetched once, not polled: this only decides where the device button in an
  // agent's header goes.
  const showingAgent = view.name === "agent" || detailView?.name === "agent";
  useEffect(() => {
    if (connection === "ready" && showingAgent) {
      void refreshDevices().catch(() => {});
    }
  }, [connection, refreshDevices, showingAgent]);

  // Let a notification click navigate to its agent — from this tab, or
  // forwarded by the service worker when a background push is tapped.
  useEffect(() => {
    setNotificationOpener((agentId, agentLabel) =>
      push({ name: "agent", agentId, agentLabel }),
    );
    setNotificationDecider((agentId, toolUseId, decision) => {
      void useAppStore.getState().decidePrompt(agentId, toolUseId, decision);
    });
    const stopRouting = startServiceWorkerRouting();

    return () => {
      setNotificationOpener(null);
      setNotificationDecider(null);
      stopRouting();
    };
  }, [push]);

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
    window.history.replaceState(
      window.history.state,
      "",
      window.location.pathname,
    );
    if ((decision === "allow" || decision === "deny") && toolUseId) {
      void useAppStore.getState().decidePrompt(agentId, toolUseId, decision);

      return;
    }
    push({ name: "agent", agentId, agentLabel: "Agent" });
  }, [push]);

  const offlineBanner = connection === "offline" && (
    <Banner tone="warning">
      Lost the connection to Argus — retrying automatically.
    </Banner>
  );

  const onResize = useCallback((w: number) => saveSidebarWidth(w), []);

  if (!isWide) {
    return (
      <div className="aw-shell">
        <SinglePane
          banner={offlineBanner}
          canGoBack={canGoBack}
          onBack={back}
          push={push}
          view={view}
        />
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
          <MasterPane banner={offlineBanner} push={push} view={masterView} />
        }
      >
        {detailView ? (
          <DetailPane onClose={back} push={push} view={detailView} />
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
      <ShortcutCheatsheet
        open={showShortcuts}
        scope="session"
        shortcuts={WEB_SHORTCUTS}
        onClose={() => setShowShortcuts(false)}
      />
    </div>
  );
}
