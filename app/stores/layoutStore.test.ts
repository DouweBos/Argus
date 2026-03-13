import { describe, expect, it, beforeEach } from "vitest";
import { useLayoutStore } from "./layoutStore";

describe("layoutStore", () => {
  beforeEach(() => {
    useLayoutStore.setState({
      leftSidebarVisible: true,
      rightSidebarVisible: true,
      leftPanelWidth: 0.18,
      rightPanelWidth: 0.35,
    });
  });

  it("has sensible defaults", () => {
    const state = useLayoutStore.getState();
    expect(state.leftSidebarVisible).toBe(true);
    expect(state.rightSidebarVisible).toBe(true);
    expect(state.leftPanelWidth).toBe(0.18);
    expect(state.rightPanelWidth).toBe(0.35);
  });

  it("toggles left sidebar", () => {
    useLayoutStore.getState().toggleLeftSidebar();
    expect(useLayoutStore.getState().leftSidebarVisible).toBe(false);
    useLayoutStore.getState().toggleLeftSidebar();
    expect(useLayoutStore.getState().leftSidebarVisible).toBe(true);
  });

  it("toggles right sidebar", () => {
    useLayoutStore.getState().toggleRightSidebar();
    expect(useLayoutStore.getState().rightSidebarVisible).toBe(false);
  });

  it("sets left panel width", () => {
    useLayoutStore.getState().setLeftPanelWidth(0.25);
    expect(useLayoutStore.getState().leftPanelWidth).toBe(0.25);
  });

  it("sets right panel width", () => {
    useLayoutStore.getState().setRightPanelWidth(0.5);
    expect(useLayoutStore.getState().rightPanelWidth).toBe(0.5);
  });
});
