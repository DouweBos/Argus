import { Script } from "node:vm";
import { describe, expect, it } from "vitest";
import { cropRect } from "./elementPicker";
import { DESCRIBE_AT } from "./pageScript";

const viewport = { width: 800, height: 600 };

describe("cropRect", () => {
  it("pads the element and clips to the viewport", () => {
    expect(
      cropRect({
        label: "button",
        bounds: { x: 2, y: 100, width: 50, height: 20 },
        viewport,
      }),
    ).toEqual({ x: 0, y: 92, width: 60, height: 36 });
  });

  it("returns null for an element scrolled out of view", () => {
    expect(
      cropRect({
        label: "div",
        bounds: { x: 0, y: -400, width: 100, height: 50 },
        viewport,
      }),
    ).toBeNull();
  });
});

describe("the page script", () => {
  it("parses as a function expression", () => {
    expect(() => new Script(`${DESCRIBE_AT}(0.5, 0.5, true)`)).not.toThrow();
  });
});
