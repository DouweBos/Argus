import { describe, expect, it, beforeEach } from "vitest";
import { useLayoutStore } from "./layoutStore";

describe("layoutStore", () => {
  beforeEach(() => {
    useLayoutStore.setState({
      leftSidebarVisible: true,
      leftPanelWidth: 0.18,
      activeToolId: null,
      toolPanelWidth: 0.3,
    });
  });

  it("has sensible defaults", () => {
    const state = useLayoutStore.getState();
    expect(state.leftSidebarVisible).toBe(true);
    expect(state.leftPanelWidth).toBe(0.18);
    expect(state.activeToolId).toBeNull();
    expect(state.toolPanelWidth).toBe(0.3);
  });

  it("toggles left sidebar", () => {
    useLayoutStore.getState().toggleLeftSidebar();
    expect(useLayoutStore.getState().leftSidebarVisible).toBe(false);
    useLayoutStore.getState().toggleLeftSidebar();
    expect(useLayoutStore.getState().leftSidebarVisible).toBe(true);
  });

  it("sets left panel width", () => {
    useLayoutStore.getState().setLeftPanelWidth(0.25);
    expect(useLayoutStore.getState().leftPanelWidth).toBe(0.25);
  });

  it("toggles tool open", () => {
    useLayoutStore.getState().toggleTool("terminal");
    expect(useLayoutStore.getState().activeToolId).toBe("terminal");
  });

  it("toggles same tool closed", () => {
    useLayoutStore.getState().toggleTool("terminal");
    useLayoutStore.getState().toggleTool("terminal");
    expect(useLayoutStore.getState().activeToolId).toBeNull();
  });

  it("switches tool when different id toggled", () => {
    useLayoutStore.getState().toggleTool("terminal");
    useLayoutStore.getState().toggleTool("simulator");
    expect(useLayoutStore.getState().activeToolId).toBe("simulator");
  });

  it("sets tool panel width", () => {
    useLayoutStore.getState().setToolPanelWidth(0.4);
    expect(useLayoutStore.getState().toolPanelWidth).toBe(0.4);
  });
});
