import type { TrimmedNode } from "./client";
import { describe, expect, it } from "vitest";
import { exportableNodes, flattenLayers, solidFill } from "./layers";

const tree: TrimmedNode = {
  id: "1:1",
  name: "Login",
  type: "FRAME",
  size: { w: 390, h: 844 },
  fills: [{ type: "SOLID", color: { r: 1, g: 1, b: 1 } }],
  children: [
    {
      id: "1:2",
      name: "Title",
      type: "TEXT",
      size: { w: 200, h: 32 },
      text: "Welcome back",
      style: {
        fontFamily: "Inter",
        fontWeight: 600,
        fontSize: 24,
        lineHeightPx: 32,
      },
    },
    { id: "1:3", name: "Back", type: "INSTANCE", size: { w: 24, h: 24 } },
    {
      id: "1:4",
      name: "Card",
      type: "FRAME",
      size: { w: 358, h: 200 },
      children: [
        { id: "1:5", name: "Icon", type: "VECTOR", size: { w: 16, h: 16 } },
      ],
    },
  ],
};

describe("flattenLayers", () => {
  it("lists every layer with depth, size, fill and font", () => {
    const rows = flattenLayers(tree);
    expect(rows.map((r) => [r.name, r.depth])).toEqual([
      ["Login", 0],
      ["Title", 1],
      ["Back", 1],
      ["Card", 1],
      ["Icon", 2],
    ]);
    expect(rows[0].fill).toBe("#ffffff");
    expect(rows[1]).toMatchObject({
      text: "Welcome back",
      font: "Inter 600 24/32",
    });
  });
});

describe("solidFill", () => {
  it("skips hidden and non-solid fills", () => {
    expect(
      solidFill([
        { type: "GRADIENT_LINEAR" },
        { type: "SOLID", visible: false, color: { r: 0, g: 0, b: 0 } },
        { type: "SOLID", color: { r: 1, g: 0, b: 0.5 } },
      ]),
    ).toBe("#ff0080");
  });
});

describe("exportableNodes", () => {
  it("finds small vectors and component instances, not big frames", () => {
    expect(exportableNodes(tree).map((n) => n.name)).toEqual(["Back", "Icon"]);
  });
});
