import { beforeEach, describe, expect, it } from "vitest";
import {
  getLayoutState,
  setLayoutState,
  setLeftPanelWidth,
  setToolPanelWidth,
  toggleLeftSidebar,
  toggleTool,
} from "./layoutStore";

describe("layoutStore", () => {
  beforeEach(() => {
    setLayoutState({
      leftSidebarVisible: true,
      leftPanelWidth: 0.18,
      activeToolId: null,
      lastActiveToolId: "terminal",
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
    expect(state.activeToolId).toBeNull();
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

  it("toggles tool open", () => {
    toggleTool("terminal");
    expect(getLayoutState().activeToolId).toBe("terminal");
  });

  it("toggles same tool closed", () => {
    toggleTool("terminal");
    toggleTool("terminal");
    expect(getLayoutState().activeToolId).toBeNull();
  });

  it("switches tool when different id toggled", () => {
    toggleTool("terminal");
    toggleTool("simulator");
    expect(getLayoutState().activeToolId).toBe("simulator");
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
