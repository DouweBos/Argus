import { describe, expect, it } from "vitest";
import { domainFor } from "../SeriesChart/scale";
import { layerAreaPath, stackLayers, stackTotals } from "./stack";

describe("stackLayers", () => {
  it("stacks each series on the ones before it", () => {
    const layers = stackLayers(
      [
        [1, 2, 3],
        [4, 0, 1],
      ],
      3,
    );
    expect(layers).toEqual([
      { lower: [0, 0, 0], upper: [1, 2, 3] },
      { lower: [1, 2, 3], upper: [5, 2, 4] },
    ]);
    expect(stackTotals(layers, 3)).toEqual([5, 2, 4]);
  });

  it("treats negatives and missing values as zero", () => {
    const [layer] = stackLayers([[-3, 2]], 3);
    expect(layer.upper).toEqual([0, 2, 0]);
  });

  it("closes an area back along the lower edge", () => {
    const [, layer] = stackLayers(
      [
        [1, 1],
        [1, 1],
      ],
      2,
    );
    const path = layerAreaPath(layer, domainFor([2, 2]));
    expect(path.startsWith("M")).toBe(true);
    expect(path.endsWith("Z")).toBe(true);
    expect(path.match(/L/g)).toHaveLength(3);
  });
});
