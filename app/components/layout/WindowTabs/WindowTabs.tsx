import type { WindowTabItem, WindowTabState } from "@argus/peacock";
import type { HostLinkState } from "@argus/peacock";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ContextMenu, Icons, WindowTabStrip } from "@argus/peacock";
import { useGlobalShortcuts } from "../../../hooks/useGlobalShortcuts";
import { useHostEntries } from "../../../hooks/useHostEntries";
import { pushCloseIntentHandler } from "../../../lib/closeIntent";
import { useCurrentRoute } from "../../../lib/routeHooks";
import { SHORTCUTS } from "../../../lib/shortcuts";
import { openHostTab } from "../../../lib/tabActions";
import { tabTitleForRoute } from "../../../lib/tabTitle";
import { LOCAL_HOST_ID } from "../../../lib/transport/hostId";
import { useSessions } from "../../../stores/sessionStore";
import {
  activateTab,
  activateTabAt,
  closeActiveTab,
  closeTab,
  cycleTab,
  reorderTab,
  setTabTitle,
  tabHostId,
  useActiveTabId,
  useTabs,
} from "../../../stores/tabStore";

const HOST_STATE: Record<HostLinkState, WindowTabState> = {
  connected: "connected",
  connecting: "reconnecting",
  detached: "disconnected",
  failed: "disconnected",
  reconnecting: "reconnecting",
};

const DIGITS = ["1", "2", "3", "4", "5", "6", "7", "8", "9"];

/**
 * The window's tab strip. Each tab is a saved route on one machine; the active
 * tab's route is the window URL, so switching tabs is a navigation and
 * everything downstream keeps reading the URL as it always did.
 */
export function WindowTabs() {
  const tabs = useTabs();
  const activeId = useActiveTabId();
  const route = useCurrentRoute();
  const sessions = useSessions();
  const { entries } = useHostEntries();
  const [menuAt, setMenuAt] = useState<{ x: number; y: number } | null>(null);

  const hosts = useMemo(
    () => new Map(entries.map((e) => [e.id, e])),
    [entries],
  );

  // The active tab is the only one whose screen is live, so it is the only one
  // whose label can be recomputed — the rest keep the name they were saved
  // with, which is also what a detached host's tab falls back to.
  const activeTitle = useMemo(() => {
    const label = route.sessionId
      ? (sessions.find((s) => s.id === route.sessionId)?.display_name ??
        sessions.find((s) => s.id === route.sessionId)?.branch ??
        null)
      : null;

    return tabTitleForRoute(route, label);
  }, [route, sessions]);

  useEffect(() => {
    setTabTitle(activeId, activeTitle);
  }, [activeId, activeTitle]);

  const items = useMemo<WindowTabItem[]>(
    () =>
      tabs.map((tab) => {
        const hostId = tabHostId(tab);
        const host = hosts.get(hostId);

        return {
          id: tab.id,
          title: tab.title,
          hostLabel: host?.label ?? hostId,
          local: hostId === LOCAL_HOST_ID,
          pinned: tab.pinned,
          active: tab.id === activeId,
          state: host ? HOST_STATE[host.state] : "disconnected",
        };
      }),
    [tabs, hosts, activeId],
  );

  const openNew = useCallback(
    (event: { clientX: number; clientY: number }) => {
      // With nothing paired there is only one machine to open a tab on, so
      // skip the menu and just open it.
      if (entries.length < 2) {
        openHostTab(LOCAL_HOST_ID, { reuse: false }).catch(() => undefined);

        return;
      }
      setMenuAt({ x: event.clientX, y: event.clientY });
    },
    [entries.length],
  );

  const newTabItems = useMemo(
    () =>
      entries.map((host) => ({
        icon:
          host.id === LOCAL_HOST_ID ? (
            <Icons.LaptopIcon size={12} />
          ) : (
            <Icons.HostIcon size={12} />
          ),
        label: host.local ? "New tab on this Mac" : `New tab on ${host.label}`,
        onClick: () => {
          openHostTab(host.id, { label: host.label, reuse: false }).catch(
            () => undefined,
          );
        },
      })),
    [entries],
  );

  // Cmd+W closes the active tab before it closes the window, but only when
  // there is a tab to close — the pinned local tab never swallows the intent.
  useEffect(() => pushCloseIntentHandler(() => closeActiveTab()), []);

  const shortcuts = useMemo(
    () => [
      {
        ...SHORTCUTS["new-tab"],
        handler: () => {
          openHostTab(LOCAL_HOST_ID, { reuse: false }).catch(() => undefined);
        },
      },
      { ...SHORTCUTS["next-tab"], handler: () => cycleTab(1) },
      { ...SHORTCUTS["prev-tab"], handler: () => cycleTab(-1) },
      ...DIGITS.map((digit, index) => ({
        key: digit,
        meta: true,
        handler: () => activateTabAt(index + 1),
      })),
    ],
    [],
  );
  useGlobalShortcuts(shortcuts);

  return (
    <>
      <WindowTabStrip
        tabs={items}
        onClose={closeTab}
        onNew={openNew}
        onReorder={reorderTab}
        onSelect={activateTab}
      />
      {menuAt && (
        <ContextMenu
          items={newTabItems}
          position={menuAt}
          onClose={() => setMenuAt(null)}
        />
      )}
    </>
  );
}
