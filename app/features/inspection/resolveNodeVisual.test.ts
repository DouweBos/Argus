import type { Capture, HierarchyNode } from "./types";
import { describe, expect, it } from "vitest";
import sampleCapture from "./__fixtures__/sample-capture.json";
import {
  findNodeById,
  flattenHierarchy,
  isVisibleLeaf,
  resolveNodeVisual,
} from "./resolveNodeVisual";

const capture = sampleCapture as unknown as Capture;

function node(partial: Partial<HierarchyNode> & { id: string }): HierarchyNode {
  return {
    type: "UIView",
    frame: { x: 0, y: 0, w: 10, h: 10 },
    children: [],
    isAccessibilityElement: false,
    accessibilityOrder: null,
    state: { enabled: true, selected: false, focused: false },
    ...partial,
  };
}

describe("resolveNodeVisual", () => {
  it("returns outline for generic container views", () => {
    const n = node({
      id: "0",
      type: "UIView",
      children: [node({ id: "0.0" })],
    });
    expect(resolveNodeVisual(n, capture)).toEqual({ kind: "outline" });
  });

  it("returns crop for visible leaf types", () => {
    const n = node({
      id: "0",
      type: "UILabel",
      frame: { x: 1, y: 2, w: 3, h: 4 },
    });
    const result = resolveNodeVisual(n, capture);
    expect(result).toEqual({
      kind: "crop",
      bounds: { x: 1, y: 2, w: 3, h: 4 },
    });
  });

  it("prefers pixelSource image when the capability is enabled", () => {
    const n = node({
      id: "0",
      type: "UILabel",
      pixelSource: { kind: "image", url: "blob:abc" },
    });
    const capable: Capture = {
      ...capture,
      capabilities: { perViewPixels: true, depthData: false },
    };
    expect(resolveNodeVisual(n, capable)).toEqual({
      kind: "image",
      url: "blob:abc",
    });
  });

  it("ignores pixelSource when capability flag is off", () => {
    const n = node({
      id: "0",
      type: "UILabel",
      pixelSource: { kind: "image", url: "blob:abc" },
    });
    expect(resolveNodeVisual(n, capture).kind).toBe("crop");
  });
});

describe("isVisibleLeaf", () => {
  it("true for web input/img/button", () => {
    for (const type of ["img", "button", "input"]) {
      expect(isVisibleLeaf(node({ id: "x", type }))).toBe(true);
    }
  });

  it("true for a child-less node that carries text", () => {
    expect(
      isVisibleLeaf(node({ id: "x", type: "UIView", label: "Hello" })),
    ).toBe(true);
  });

  it("false for containers with children", () => {
    expect(
      isVisibleLeaf(
        node({ id: "x", type: "UIView", children: [node({ id: "x.0" })] }),
      ),
    ).toBe(false);
  });
});

describe("flattenHierarchy + findNodeById", () => {
  it("flattens the fixture depth-first", () => {
    const flat = flattenHierarchy(capture.hierarchy);
    expect(flat[0].id).toBe("0");
    expect(flat.some((n) => n.id === "0.0.3")).toBe(true);
    expect(flat.length).toBeGreaterThan(5);
  });

  it("findNodeById walks the tree", () => {
    const found = findNodeById(capture.hierarchy, "0.0.3");
    expect(found?.label).toBe("Sign In");
    expect(findNodeById(capture.hierarchy, "does-not-exist")).toBeNull();
  });
});
