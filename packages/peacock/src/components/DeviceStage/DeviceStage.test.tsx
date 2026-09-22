import { describe, expect, it } from "vitest";
import { unrotate } from "./DeviceStage";

describe("unrotate", () => {
  it("leaves an upright stream alone", () => {
    expect(unrotate(0.25, 0.75, 0)).toEqual({ x: 0.25, y: 0.75 });
  });

  // The top-left of a quarter-turned picture is the bottom-left of the stream.
  it("maps the displayed top-left back onto the device's own corner", () => {
    expect(unrotate(0, 0, 90)).toEqual({ x: 0, y: 1 });
    expect(unrotate(0, 0, 270)).toEqual({ x: 1, y: 0 });
    expect(unrotate(0, 0, 180)).toEqual({ x: 1, y: 1 });
  });

  it("round-trips the centre at every rotation", () => {
    for (const r of [0, 90, 180, 270] as const) {
      expect(unrotate(0.5, 0.5, r)).toEqual({ x: 0.5, y: 0.5 });
    }
  });
});
