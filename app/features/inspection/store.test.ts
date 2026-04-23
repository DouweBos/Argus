import { beforeEach, describe, expect, it } from "vitest";
import { findNodeById } from "./resolveNodeVisual";
import {
  getInspectionState,
  loadFixtureCapture,
  resetInspectionState,
  selectCapture,
  selectNode,
  setSidebarTab,
} from "./store";

describe("inspection store", () => {
  beforeEach(() => {
    resetInspectionState();
  });

  it("loadFixtureCapture populates captures + activeCaptureId", () => {
    const id = loadFixtureCapture();
    const s = getInspectionState();
    expect(s.activeCaptureId).toBe(id);
    expect(s.captureOrder).toEqual([id]);
    expect(s.captures[id].device.platform).toBe("ios");
  });

  it("selectNode + selectCapture update selection", () => {
    const id = loadFixtureCapture();
    selectNode("0.0.3");
    expect(getInspectionState().selectedNodeId).toBe("0.0.3");
    selectCapture(id);
    expect(getInspectionState().selectedNodeId).toBeNull();
  });

  it("setSidebarTab switches the active sidebar tab", () => {
    expect(getInspectionState().sidebarTab).toBe("hierarchy");
    setSidebarTab("a11y");
    expect(getInspectionState().sidebarTab).toBe("a11y");
    setSidebarTab("hierarchy");
    expect(getInspectionState().sidebarTab).toBe("hierarchy");
  });
});

describe("findNodeById", () => {
  it("walks the fixture tree to find deep nodes", () => {
    const id = loadFixtureCapture();
    const capture = getInspectionState().captures[id];
    const node = findNodeById(capture.hierarchy, "0.0.3");
    expect(node?.label).toBe("Sign In");
  });
});
