import type { Capture, HierarchyNode } from "./types";
import { describe, expect, it } from "vitest";
import sampleCapture from "./__fixtures__/sample-capture.json";
import {
  ancestorIds,
  buildParentMap,
  collectVisibleIds,
  findNodeById,
  flattenHierarchy,
  isVisibleLeaf,
  nodeHint,
  nodeRect,
  resolveNodeVisual,
} from "./resolveNodeVisual";

const capture = sampleCapture as unknown as Capture;

function node(partial: Partial<HierarchyNode> & { id: string }): HierarchyNode {
  return {
    class: "UIView",
    frame: { x: 0, y: 0, w: 10, h: 10 },
    depth: 0,
    children: [],
    ...partial,
  };
}

describe("resolveNodeVisual", () => {
  it("returns a fill with the real background color", () => {
    const n = node({ id: "0x1", backgroundColor: "#007AFFFF" });
    expect(resolveNodeVisual(n)).toEqual({ kind: "fill", color: "#007AFFFF" });
  });

  it("returns outline for nodes without a background color", () => {
    const n = node({ id: "0x1", class: "UIView" });
    expect(resolveNodeVisual(n)).toEqual({ kind: "outline" });
  });
});

describe("isVisibleLeaf + nodeRect", () => {
  it("leaf ⇔ no children", () => {
    expect(isVisibleLeaf(node({ id: "x" }))).toBe(true);
    expect(
      isVisibleLeaf(node({ id: "x", children: [node({ id: "x.0" })] })),
    ).toBe(false);
  });

  it("prefers absFrame over the local frame", () => {
    const n = node({
      id: "x",
      frame: { x: 0, y: 0, w: 5, h: 5 },
      absFrame: { x: 10, y: 20, w: 30, h: 40 },
    });
    expect(nodeRect(n)).toEqual({ x: 10, y: 20, w: 30, h: 40 });
    expect(nodeRect(node({ id: "y" }))).toEqual({ x: 0, y: 0, w: 10, h: 10 });
  });
});

describe("flattenHierarchy + findNodeById", () => {
  it("flattens the fixture depth-first", () => {
    const flat = flattenHierarchy(capture.hierarchy);
    expect(flat[0].id).toBe("0x1");
    expect(flat.some((n) => n.id === "0x5")).toBe(true);
    expect(flat).toHaveLength(6);
  });

  it("findNodeById walks the tree", () => {
    const found = findNodeById(capture.hierarchy, "0x5");
    expect(found?.title).toBe("Sign In");
    expect(findNodeById(capture.hierarchy, "does-not-exist")).toBeNull();
  });
});

describe("nodeHint", () => {
  it("prefers text, then identifier, then image, then background", () => {
    expect(nodeHint(node({ id: "1", text: "Hello" }))).toBe('"Hello"');
    expect(nodeHint(node({ id: "1", title: "Sign In" }))).toBe('"Sign In"');
    expect(nodeHint(node({ id: "1", rn: { testID: "submit-btn" } }))).toBe(
      "#submit-btn",
    );
    expect(nodeHint(node({ id: "1", accessibilityIdentifier: "email" }))).toBe(
      "#email",
    );
    expect(
      nodeHint(
        node({ id: "1", image: { w: 40, h: 40, scale: 2, name: "avatar" } }),
      ),
    ).toBe("img:avatar");
    expect(nodeHint(node({ id: "1", backgroundColor: "#112233FF" }))).toBe(
      "#112233FF",
    );
  });

  it("returns undefined for an anonymous node and skips transparent fills", () => {
    expect(nodeHint(node({ id: "1", class: "UIView" }))).toBeUndefined();
    expect(
      nodeHint(node({ id: "1", backgroundColor: "#11223300" })),
    ).toBeUndefined();
  });
});

describe("parent map ancestry (opaque ids)", () => {
  it("resolves strict ancestors from the tree, not the id string", () => {
    const parents = buildParentMap(capture.hierarchy);
    expect(ancestorIds(parents, "0x5")).toEqual(["0x2", "0x1"]);
    expect(ancestorIds(parents, "0x1")).toEqual([]);
  });

  it("collectVisibleIds unions ids with their ancestors", () => {
    const parents = buildParentMap(capture.hierarchy);
    const visible = collectVisibleIds(parents, ["0x5"]);
    expect(visible).toEqual(new Set(["0x5", "0x2", "0x1"]));
  });
});
