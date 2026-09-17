/**
 * Browser-style window tabs. Each tab holds one saved route, so "mini:
 * fix-login" and "this Mac: docs-tweak" sit side by side and flipping between
 * them puts back exactly what you were looking at.
 *
 * The URL is still the only source of truth for "which screen am I on": the
 * active tab's saved path *is* the window URL, and switching tabs is a
 * navigation. A tab is a saved route plus identity — nothing here mirrors the
 * live route. Back/forward is per tab, because one global history would
 * interleave two machines' screens into one useless stack.
 *
 * This store never touches transports: closing a tab hides a view, it never
 * stops the agents running on that host.
 */

import { create } from "zustand";
import { getCurrentPath, navigateToPath, parseRoute } from "../lib/router";
import { LOCAL_HOST_ID, type HostId } from "../lib/transport/hostId";

const STORAGE_KEY = "argus:window-tabs";
const MAX_HISTORY = 50;

/** The pinned "This Mac" tab. Always index 0, never closable. */
export const LOCAL_TAB_ID = "tab-local";

export interface WindowTab {
  /** Previously visited paths in this tab, oldest first. */
  back: string[];
  forward: string[];
  id: string;
  /** Full path including `?host=` — the route this tab restores. */
  path: string;
  /** Pinned tabs cannot be closed or dragged out of place. */
  pinned: boolean;
  /** Last known label, kept so a detached host's tab still reads sensibly. */
  title: string;
}

interface TabState {
  activeId: string;
  tabs: WindowTab[];
}

/** Which host a tab reads from — derived from its path, never stored twice. */
export const tabHostId = (tab: WindowTab): HostId =>
  parseRoute(tab.path).hostId;

function localTab(): WindowTab {
  return {
    id: LOCAL_TAB_ID,
    path: "/",
    title: "This Mac",
    pinned: true,
    back: [],
    forward: [],
  };
}

function defaultState(): TabState {
  return { tabs: [localTab()], activeId: LOCAL_TAB_ID };
}

interface PersistedTab {
  id: string;
  path: string;
  pinned: boolean;
  title: string;
}

function load(): TabState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return defaultState();
    }
    const parsed = JSON.parse(raw) as {
      activeId?: unknown;
      tabs?: unknown;
    };
    if (!Array.isArray(parsed.tabs)) {
      return defaultState();
    }
    const restored = parsed.tabs
      .filter((t): t is PersistedTab => {
        if (!t || typeof t !== "object") {
          return false;
        }
        const tab = t as Record<string, unknown>;

        return typeof tab.id === "string" && typeof tab.path === "string";
      })
      .map(
        (t): WindowTab => ({
          id: t.id,
          path: t.path,
          title: typeof t.title === "string" ? t.title : "Argus",
          pinned: t.id === LOCAL_TAB_ID,
          back: [],
          forward: [],
        }),
      );

    // The local tab is structural: re-create it if a stale payload lost it,
    // and keep it leftmost whatever order was saved.
    const local = restored.find((t) => t.id === LOCAL_TAB_ID) ?? localTab();
    const tabs = [local, ...restored.filter((t) => t.id !== LOCAL_TAB_ID)];
    const activeId =
      typeof parsed.activeId === "string" &&
      tabs.some((t) => t.id === parsed.activeId)
        ? parsed.activeId
        : LOCAL_TAB_ID;

    return { tabs, activeId };
  } catch {
    return defaultState();
  }
}

function persist(state: TabState): void {
  try {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        activeId: state.activeId,
        tabs: state.tabs.map(({ id, path, title, pinned }) => ({
          id,
          path,
          title,
          pinned,
        })),
      }),
    );
  } catch {
    // localStorage may be unavailable (private mode); silently drop.
  }
}

const store = create<TabState>(() => load());

store.subscribe(persist);

export const useTabs = (): WindowTab[] => store((s) => s.tabs);
export const useActiveTabId = (): string => store((s) => s.activeId);
export const getTabState = (): TabState => store.getState();

export const getActiveTab = (): WindowTab | undefined => {
  const { tabs, activeId } = store.getState();

  return tabs.find((t) => t.id === activeId);
};

export const useCanGoBack = (): boolean =>
  store((s) => (s.tabs.find((t) => t.id === s.activeId)?.back.length ?? 0) > 0);

export const useCanGoForward = (): boolean =>
  store(
    (s) => (s.tabs.find((t) => t.id === s.activeId)?.forward.length ?? 0) > 0,
  );

// Paths this store itself asked the router for. They must not be recorded as
// a fresh navigation, or every tab switch would push the other tab's screen
// onto this tab's back stack.
let applying: string | null = null;

function go(path: string): void {
  applying = path;
  navigateToPath(path);
}

function patch(id: string, change: Partial<WindowTab>): void {
  store.setState((s) => ({
    tabs: s.tabs.map((t) => (t.id === id ? { ...t, ...change } : t)),
  }));
}

/**
 * Fold a completed navigation into the active tab. Called for every URL
 * change; the URL stays the source of truth and this only remembers where the
 * tab has been.
 */
export function recordNavigation(path: string): void {
  const { tabs, activeId } = store.getState();
  const tab = tabs.find((t) => t.id === activeId);
  if (!tab) {
    return;
  }
  if (applying === path) {
    applying = null;
    if (tab.path !== path) {
      patch(tab.id, { path });
    }

    return;
  }
  applying = null;
  if (tab.path === path) {
    return;
  }
  patch(tab.id, {
    path,
    back: [...tab.back, tab.path].slice(-MAX_HISTORY),
    forward: [],
  });
}

/** Remember a human label for a tab (the session branch, the screen name). */
export function setTabTitle(id: string, title: string): void {
  const tab = store.getState().tabs.find((t) => t.id === id);
  if (!tab || tab.title === title) {
    return;
  }
  patch(id, { title });
}

export function activateTab(id: string): void {
  const { tabs, activeId } = store.getState();
  const tab = tabs.find((t) => t.id === id);
  if (!tab || id === activeId) {
    return;
  }
  store.setState({ activeId: id });
  go(tab.path);
}

/** Jump to the nth tab (1-based), as Cmd+1…Cmd+9 do. */
export function activateTabAt(index: number): void {
  const tab = store.getState().tabs[index - 1];
  if (tab) {
    activateTab(tab.id);
  }
}

export function cycleTab(direction: -1 | 1): void {
  const { tabs, activeId } = store.getState();
  const at = tabs.findIndex((t) => t.id === activeId);
  if (at === -1 || tabs.length < 2) {
    return;
  }
  const next = (at + direction + tabs.length) % tabs.length;
  activateTab(tabs[next].id);
}

let seq = 0;

export interface OpenTabOptions {
  /** Open in the background (no navigation). */
  background?: boolean;
  hostId?: HostId;
  path?: string;
  title?: string;
}

/** Open a new tab. Returns its id. */
export function openTab(options: OpenTabOptions = {}): string {
  const hostId = options.hostId ?? LOCAL_HOST_ID;
  const path =
    options.path ??
    (hostId === LOCAL_HOST_ID ? "/" : `/?host=${encodeURIComponent(hostId)}`);
  seq += 1;
  const tab: WindowTab = {
    id: `tab-${Date.now().toString(36)}-${seq}`,
    path,
    title: options.title ?? "New tab",
    pinned: false,
    back: [],
    forward: [],
  };
  store.setState((s) => ({ tabs: [...s.tabs, tab] }));
  if (!options.background) {
    activateTab(tab.id);
  }

  return tab.id;
}

/**
 * Close a tab. Pinned tabs stay. Returns true when something closed, so the
 * Cmd+W close-intent chain knows whether to fall through to the window.
 */
export function closeTab(id: string): boolean {
  const { tabs, activeId } = store.getState();
  const at = tabs.findIndex((t) => t.id === id);
  if (at === -1 || tabs[at].pinned) {
    return false;
  }
  const remaining = tabs.filter((t) => t.id !== id);
  store.setState({ tabs: remaining });
  if (id === activeId) {
    // Focus the neighbour on the right, falling back to the one on the left —
    // the same place a browser leaves you.
    const next = remaining[Math.min(at, remaining.length - 1)];
    if (next) {
      store.setState({ activeId: next.id });
      go(next.path);
    }
  }

  return true;
}

export function closeActiveTab(): boolean {
  return closeTab(store.getState().activeId);
}

export type TabDropSide = "after" | "before";

/** Drag reorder. The pinned local tab stays leftmost and cannot be moved. */
export function reorderTab(
  fromId: string,
  targetId: string,
  side: TabDropSide,
): void {
  store.setState((s) => {
    const from = s.tabs.findIndex((t) => t.id === fromId);
    const target = s.tabs.findIndex((t) => t.id === targetId);
    if (
      from === -1 ||
      target === -1 ||
      from === target ||
      s.tabs[from].pinned
    ) {
      return s;
    }
    const without = s.tabs.filter((t) => t.id !== fromId);
    const targetAt = without.findIndex((t) => t.id === targetId);
    const insertAt = side === "before" ? targetAt : targetAt + 1;
    const pinnedCount = without.filter((t) => t.pinned).length;
    const clamped = Math.max(pinnedCount, insertAt);
    without.splice(clamped, 0, s.tabs[from]);

    return { tabs: without };
  });
}

/**
 * Put the saved route back on screen at launch. Called once after the router
 * is mounted; a tab whose host is not attached still restores — it shows the
 * last snapshot in a disconnected state rather than silently moving to
 * another machine.
 */
export function restoreActiveTab(): void {
  const tab = getActiveTab();
  if (!tab) {
    return;
  }
  if (tab.path === getCurrentPath()) {
    return;
  }
  go(tab.path);
}

export function goBackInTab(): void {
  const { tabs, activeId } = store.getState();
  const tab = tabs.find((t) => t.id === activeId);
  if (!tab || tab.back.length === 0) {
    return;
  }
  const target = tab.back[tab.back.length - 1];
  patch(tab.id, {
    path: target,
    back: tab.back.slice(0, -1),
    forward: [tab.path, ...tab.forward].slice(0, MAX_HISTORY),
  });
  go(target);
}

export function goForwardInTab(): void {
  const { tabs, activeId } = store.getState();
  const tab = tabs.find((t) => t.id === activeId);
  if (!tab || tab.forward.length === 0) {
    return;
  }
  const [target, ...rest] = tab.forward;
  patch(tab.id, {
    path: target,
    back: [...tab.back, tab.path].slice(-MAX_HISTORY),
    forward: rest,
  });
  go(target);
}

/** Test seam. */
export function resetTabs(): void {
  applying = null;
  store.setState(defaultState(), true);
}
