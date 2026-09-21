import { describe, expect, it } from "vitest";
import { hidUsageForKeyCode, modifierUsages } from "./hidUsage";

describe("hidUsageForKeyCode", () => {
  it("maps letter keys to their HID usages", () => {
    expect(hidUsageForKeyCode(0)).toBe(0x04); // a
    expect(hidUsageForKeyCode(11)).toBe(0x05); // b
    expect(hidUsageForKeyCode(8)).toBe(0x06); // c
  });

  it("maps the keys the runtime view sends for navigation", () => {
    expect(hidUsageForKeyCode(36)).toBe(0x28); // return
    expect(hidUsageForKeyCode(51)).toBe(0x2a); // delete
    expect(hidUsageForKeyCode(49)).toBe(0x2c); // space
    expect(hidUsageForKeyCode(53)).toBe(0x29); // escape
  });

  it("returns null for key codes with no usage", () => {
    expect(hidUsageForKeyCode(63)).toBeNull();
    expect(hidUsageForKeyCode(999)).toBeNull();
  });
});

describe("modifierUsages", () => {
  it("returns nothing when no modifiers are set", () => {
    expect(modifierUsages(0)).toEqual([]);
  });

  it("maps each NSEvent modifier flag to its left-hand key", () => {
    expect(modifierUsages(1 << 17)).toEqual([0xe1]); // shift
    expect(modifierUsages(1 << 18)).toEqual([0xe0]); // control
    expect(modifierUsages(1 << 19)).toEqual([0xe2]); // option
    expect(modifierUsages(1 << 20)).toEqual([0xe3]); // command
  });

  it("returns every modifier in a chord", () => {
    expect(modifierUsages((1 << 17) | (1 << 20))).toEqual([0xe1, 0xe3]);
  });

  it("ignores flags that are not modifier keys", () => {
    expect(modifierUsages(1 << 16)).toEqual([]); // caps lock
  });
});
