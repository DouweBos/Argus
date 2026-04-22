// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  getLayoutState,
  setLayoutState,
  setLeftPanelWidth,
  setToolPanelWidth,
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
      leftPanelWidth: 0.18,
      activeToolBySessionId: {},
      lastActiveToolBySessionId: {},
      mountedToolIds: {
        changes: false,
        simulator: false,
        terminal: false,
      },
      toolPanelWidth: 0.3,
    });
  });

  it("has sensible defaults", () => {
    const state = getLayoutState();
    expect(state.leftSidebarVisible).toBe(true);
    expect(state.leftPanelWidth).toBe(0.18);
    expect(state.activeToolBySessionId).toEqual({});
    expect(state.toolPanelWidth).toBe(0.3);
  });

  it("toggles left sidebar", () => {
    toggleLeftSidebar();
    expect(getLayoutState().leftSidebarVisible).toBe(false);
    toggleLeftSidebar();
    expect(getLayoutState().leftSidebarVisible).toBe(true);
  });

  it("sets left panel width", () => {
    setLeftPanelWidth(0.25);
    expect(getLayoutState().leftPanelWidth).toBe(0.25);
  });

  it("toggles tool open for current session", () => {
    toggleTool("terminal");
    expect(getLayoutState().activeToolBySessionId["ws-1"]).toBe("terminal");
  });

  it("toggles same tool closed", () => {
    toggleTool("terminal");
    toggleTool("terminal");
    expect(getLayoutState().activeToolBySessionId["ws-1"]).toBeNull();
  });

  it("remembers the last active tool per session after closing", () => {
    toggleTool("simulator");
    toggleTool("simulator");
    expect(getLayoutState().activeToolBySessionId["ws-1"]).toBeNull();
    expect(getLayoutState().lastActiveToolBySessionId["ws-1"]).toBe(
      "simulator",
    );
  });

  it("switches tool when different id toggled", () => {
    toggleTool("terminal");
    toggleTool("simulator");
    expect(getLayoutState().activeToolBySessionId["ws-1"]).toBe("simulator");
  });

  it("marks a tool mounted when opened and keeps it after close", () => {
    expect(getLayoutState().mountedToolIds.terminal).toBe(false);
    toggleTool("terminal");
    expect(getLayoutState().mountedToolIds.terminal).toBe(true);
    toggleTool("terminal");
    expect(getLayoutState().mountedToolIds.terminal).toBe(true);
  });

  it("sets tool panel width", () => {
    setToolPanelWidth(0.4);
    expect(getLayoutState().toolPanelWidth).toBe(0.4);
  });
});
