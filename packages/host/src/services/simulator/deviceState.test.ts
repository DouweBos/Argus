import { describe, expect, it } from "vitest";
import { isLandscape, rotationForUiOrientation } from "./deviceState";

describe("rotationForUiOrientation", () => {
  it("maps each panel orientation to its clockwise correction", () => {
    expect(rotationForUiOrientation(1)).toBe(0);
    expect(rotationForUiOrientation(2)).toBe(180);
    expect(rotationForUiOrientation(3)).toBe(90);
    expect(rotationForUiOrientation(4)).toBe(270);
  });

  it("leaves the stream alone for an unknown value", () => {
    expect(rotationForUiOrientation(0)).toBe(0);
    expect(rotationForUiOrientation(99)).toBe(0);
  });
});

describe("isLandscape", () => {
  it("is true only on its side", () => {
    expect(isLandscape("landscapeLeft")).toBe(true);
    expect(isLandscape("landscapeRight")).toBe(true);
    expect(isLandscape("portrait")).toBe(false);
    expect(isLandscape("portraitUpsideDown")).toBe(false);
  });
});
