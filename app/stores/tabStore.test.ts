import type * as RouterModule from "../lib/router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  activateTab,
  activateTabAt,
  closeActiveTab,
  closeTab,
  getActiveTab,
  getTabState,
  goBackInTab,
  goForwardInTab,
  LOCAL_TAB_ID,
  openTab,
  recordNavigation,
  reorderTab,
  resetTabs,
  tabHostId,
} from "./tabStore";

const { mockStorage, navigated } = vi.hoisted(() => {
  const storage: Record<string, string> = {};
  const paths: string[] = [];
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => storage[key] ?? null,
    setItem: (key: string, value: string) => {
      storage[key] = value;
    },
    removeItem: (key: string) => {
      // eslint-disable-next-line @typescript-eslint/no-dynamic-delete -- test-only mock storage reset
      delete storage[key];
    },
  });

  return { mockStorage: storage, navigated: paths };
});

// The router is the real one apart from the navigate call itself: no router is
// mounted in a unit test, so navigations are collected instead of applied.
vi.mock("../lib/router", async (importOriginal) => {
  const actual = await importOriginal<typeof RouterModule>();

  return {
    ...actual,
    navigateToPath: (path: string) => {
      navigated.push(path);
    },
    getCurrentPath: () => navigated[navigated.length - 1] ?? "/",
  };
});

/** Stand in for the router: a navigation lands, then the URL is recorded. */
function navigate(path: string): void {
  navigated.push(path);
  recordNavigation(path);
}

describe("tabStore", () => {
  beforeEach(() => {
    for (const key of Object.keys(mockStorage)) {
      // eslint-disable-next-line @typescript-eslint/no-dynamic-delete -- test-only mock storage reset
      delete mockStorage[key];
    }
    navigated.length = 0;
    resetTabs();
  });

  it("starts with a single pinned local tab", () => {
    const { tabs, activeId } = getTabState();
    expect(tabs).toHaveLength(1);
    expect(tabs[0].id).toBe(LOCAL_TAB_ID);
    expect(tabs[0].pinned).toBe(true);
    expect(tabHostId(tabs[0])).toBe("local");
    expect(activeId).toBe(LOCAL_TAB_ID);
  });

  it("never closes the local tab", () => {
    expect(closeTab(LOCAL_TAB_ID)).toBe(false);
    expect(closeActiveTab()).toBe(false);
    expect(getTabState().tabs).toHaveLength(1);
  });

  it("opens a tab on another host and points its route at it", () => {
    const id = openTab({ hostId: "mini", title: "Mac mini" });
    const tab = getActiveTab();
    expect(tab?.id).toBe(id);
    expect(tabHostId(tab!)).toBe("mini");
    expect(navigated.at(-1)).toBe("/?host=mini");
  });

  it("keeps each tab's route and restores it when switched back", () => {
    navigate("/sessions/local-1/git");
    const remote = openTab({ hostId: "mini" });
    navigate("/sessions/mini-1/agents?host=mini");

    activateTab(LOCAL_TAB_ID);
    expect(navigated.at(-1)).toBe("/sessions/local-1/git");
    recordNavigation("/sessions/local-1/git");

    activateTab(remote);
    expect(navigated.at(-1)).toBe("/sessions/mini-1/agents?host=mini");
  });

  it("switching tabs does not leak into the other tab's history", () => {
    navigate("/sessions/local-1/git");
    const remote = openTab({ hostId: "mini" });
    navigate("/devices?host=mini");
    activateTab(LOCAL_TAB_ID);
    recordNavigation("/sessions/local-1/git");

    const local = getTabState().tabs.find((t) => t.id === LOCAL_TAB_ID);
    expect(local?.back).toEqual(["/"]);
    const remoteTab = getTabState().tabs.find((t) => t.id === remote);
    expect(remoteTab?.back).toEqual(["/?host=mini"]);
  });

  it("walks back and forward inside the active tab only", () => {
    navigate("/agents");
    navigate("/devices");
    const other = openTab({ hostId: "mini" });
    activateTab(LOCAL_TAB_ID);
    recordNavigation("/devices");

    goBackInTab();
    expect(navigated.at(-1)).toBe("/agents");
    recordNavigation("/agents");
    expect(getActiveTab()?.path).toBe("/agents");

    goForwardInTab();
    expect(navigated.at(-1)).toBe("/devices");
    recordNavigation("/devices");
    expect(getActiveTab()?.path).toBe("/devices");

    expect(getTabState().tabs.find((t) => t.id === other)?.back).toEqual([]);
  });

  it("focuses the neighbour when the active tab closes", () => {
    const first = openTab({ hostId: "mini" });
    const second = openTab({ hostId: "linux" });
    activateTab(first);
    recordNavigation("/?host=mini");

    closeTab(first);
    expect(getTabState().activeId).toBe(second);

    closeTab(second);
    expect(getTabState().activeId).toBe(LOCAL_TAB_ID);
    expect(getTabState().tabs).toHaveLength(1);
  });

  it("jumps to a tab by index and cycles", () => {
    const second = openTab({ hostId: "mini" });
    activateTabAt(1);
    expect(getTabState().activeId).toBe(LOCAL_TAB_ID);
    activateTabAt(2);
    expect(getTabState().activeId).toBe(second);
    activateTabAt(9);
    expect(getTabState().activeId).toBe(second);
  });

  it("keeps the pinned tab leftmost when reordering", () => {
    const a = openTab({ hostId: "mini", background: true });
    const b = openTab({ hostId: "linux", background: true });
    reorderTab(b, LOCAL_TAB_ID, "before");
    expect(getTabState().tabs.map((t) => t.id)).toEqual([LOCAL_TAB_ID, b, a]);
    reorderTab(LOCAL_TAB_ID, a, "after");
    expect(getTabState().tabs[0].id).toBe(LOCAL_TAB_ID);
  });

  it("closing a tab leaves that host attached and its agents running", async () => {
    const { addHostConnection, isHostAttached, resetConnections } =
      await import("./connectionStore");
    const { getAgentState, setAgentState } = await import("./agentStore");
    resetConnections();
    addHostConnection({
      hostId: "mini",
      label: "Mac mini",
      mode: "remote",
      state: "ready",
      hydrated: true,
      lastError: null,
      attachedAt: 1,
    });
    const running = { agent_id: "a1", session_id: "s1", status: "running" };
    setAgentState({ agents: { a1: running } as never });

    const tab = openTab({ hostId: "mini" });
    closeTab(tab);

    // Tabs are a view onto a host, not its lifetime: the socket stays up and
    // the agent keeps working while nobody is looking at it.
    expect(isHostAttached("mini")).toBe(true);
    expect(getAgentState().agents.a1?.status).toBe("running");
    resetConnections();
  });

  it("restores the saved tabs and active tab after a restart", async () => {
    openTab({ hostId: "mini", title: "Mac mini" });
    navigate("/sessions/mini-1/agents?host=mini");

    vi.resetModules();
    navigated.length = 0;
    const fresh = await import("./tabStore");

    const restored = fresh.getTabState();
    expect(restored.tabs).toHaveLength(2);
    expect(restored.tabs[0].id).toBe(fresh.LOCAL_TAB_ID);
    expect(restored.tabs[1].title).toBe("Mac mini");
    expect(fresh.getActiveTab()?.path).toBe(
      "/sessions/mini-1/agents?host=mini",
    );

    fresh.restoreActiveTab();
    expect(navigated.at(-1)).toBe("/sessions/mini-1/agents?host=mini");
  });

  it("restores a tab whose host is gone instead of dropping it", async () => {
    openTab({ hostId: "mini", title: "Mac mini" });
    vi.resetModules();
    const fresh = await import("./tabStore");
    const tab = fresh.getTabState().tabs[1];
    expect(tab).toBeDefined();
    expect(fresh.tabHostId(tab)).toBe("mini");
  });
});
