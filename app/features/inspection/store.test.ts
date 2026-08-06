import { beforeEach, describe, expect, it } from "vitest";
import { findNodeById } from "./resolveNodeVisual";
import {
  getInspectionState,
  loadFixtureCapture,
  resetInspectionState,
  selectCapture,
  selectNode,
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
    selectNode("0x5");
    expect(getInspectionState().selectedNodeId).toBe("0x5");
    selectCapture(id);
    expect(getInspectionState().selectedNodeId).toBeNull();
  });
});

describe("findNodeById", () => {
  it("walks the fixture tree to find deep nodes", () => {
    const id = loadFixtureCapture();
    const capture = getInspectionState().captures[id];
    const node = findNodeById(capture.hierarchy, "0x5");
    expect(node?.title).toBe("Sign In");
    expect(node?.backgroundColor).toBe("#007AFFFF");
  });
});
