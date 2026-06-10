// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  getLayoutState,
  setBottomPanelHeight,
  setLayoutState,
  setLeftPanelWidth,
  setRightPanelWidth,
  toggleLeftSidebar,
  toggleTool,
} from "./layoutStore";

vi.mock("../lib/router", () => ({
  getCurrentRoute: () => ({
    view: "session",
    sessionId: "ws-1",
    organizationId: null,
    panel: "agents",
  }),
}));

vi.mock("../lib/routeHooks", () => ({
  useRouteSessionId: () => "ws-1",
}));

describe("layoutStore", () => {
  beforeEach(() => {
    setLayoutState({
      leftSidebarVisible: true,
      leftPanelWidth: 280,
      activeRightToolBySessionId: {},
      activeBottomToolBySessionId: {},
      lastActiveRightToolBySessionId: {},
      lastActiveBottomToolBySessionId: {},
      mountedToolIds: {
        changes: false,
        debug: false,
        notifications: false,
        simulator: false,
        terminal: false,
      },
      rightPanelWidth: 420,
      bottomPanelHeight: 0.3,
    });
  });

  it("has sensible defaults", () => {
    const state = getLayoutState();
    expect(state.leftSidebarVisible).toBe(true);
    expect(state.leftPanelWidth).toBe(280);
    expect(state.activeRightToolBySessionId).toEqual({});
    expect(state.activeBottomToolBySessionId).toEqual({});
    expect(state.rightPanelWidth).toBe(420);
    expect(state.bottomPanelHeight).toBe(0.3);
  });

  it("toggles left sidebar", () => {
    toggleLeftSidebar();
    expect(getLayoutState().leftSidebarVisible).toBe(false);
    toggleLeftSidebar();
    expect(getLayoutState().leftSidebarVisible).toBe(true);
  });

  it("sets left panel width", () => {
    setLeftPanelWidth(320);
    expect(getLayoutState().leftPanelWidth).toBe(320);
  });

  it("opens a bottom tool in the bottom slot", () => {
    toggleTool("terminal");
    expect(getLayoutState().activeBottomToolBySessionId["ws-1"]).toBe(
      "terminal",
    );
    expect(getLayoutState().activeRightToolBySessionId["ws-1"]).toBeUndefined();
  });

  it("opens a right tool in the right slot", () => {
    toggleTool("simulator");
    expect(getLayoutState().activeRightToolBySessionId["ws-1"]).toBe(
      "simulator",
    );
    expect(
      getLayoutState().activeBottomToolBySessionId["ws-1"],
    ).toBeUndefined();
  });

  it("right and bottom panels stay independent", () => {
    toggleTool("terminal");
    toggleTool("simulator");
    expect(getLayoutState().activeBottomToolBySessionId["ws-1"]).toBe(
      "terminal",
    );
    expect(getLayoutState().activeRightToolBySessionId["ws-1"]).toBe(
      "simulator",
    );
  });

  it("toggles same tool closed", () => {
    toggleTool("terminal");
    toggleTool("terminal");
    expect(getLayoutState().activeBottomToolBySessionId["ws-1"]).toBeNull();
  });

  it("remembers the last active tool per session and placement after closing", () => {
    toggleTool("simulator");
    toggleTool("simulator");
    expect(getLayoutState().activeRightToolBySessionId["ws-1"]).toBeNull();
    expect(getLayoutState().lastActiveRightToolBySessionId["ws-1"]).toBe(
      "simulator",
    );
  });

  it("switches tool when different id in same placement is toggled", () => {
    toggleTool("terminal");
    toggleTool("debug");
    expect(getLayoutState().activeBottomToolBySessionId["ws-1"]).toBe("debug");
  });

  it("marks a tool mounted when opened and keeps it after close", () => {
    expect(getLayoutState().mountedToolIds.terminal).toBe(false);
    toggleTool("terminal");
    expect(getLayoutState().mountedToolIds.terminal).toBe(true);
    toggleTool("terminal");
    expect(getLayoutState().mountedToolIds.terminal).toBe(true);
  });

  it("sets right and bottom panel sizes", () => {
    setRightPanelWidth(0.4);
    setBottomPanelHeight(0.5);
    expect(getLayoutState().rightPanelWidth).toBe(0.4);
    expect(getLayoutState().bottomPanelHeight).toBe(0.5);
  });
});
