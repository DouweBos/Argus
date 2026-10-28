import { describe, expect, it } from "vitest";
import { fitView, zoomAround } from "./ZoomPanImage";

describe("fitView", () => {
  it("shrinks a large image to fit and centres it", () => {
    expect(fitView(200, 400, 400, 400)).toEqual({ scale: 0.5, x: 0, y: 100 });
  });

  it("never enlarges a small image past 100%", () => {
    expect(fitView(400, 400, 100, 50)).toEqual({ scale: 1, x: 150, y: 175 });
  });
});

describe("zoomAround", () => {
  it("keeps the anchor point still", () => {
    const next = zoomAround({ scale: 1, x: 10, y: 20 }, 2, 50, 50);
    expect(next).toEqual({ scale: 2, x: -30, y: -10 });
  });

  it("clamps the scale", () => {
    expect(zoomAround({ scale: 1, x: 0, y: 0 }, 100, 0, 0).scale).toBe(8);
  });
});
