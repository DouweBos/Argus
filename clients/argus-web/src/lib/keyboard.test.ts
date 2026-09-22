/**
 * The Enter-key question: a laptop sends on Enter, a phone must not, because a
 * soft keyboard has no Shift to type a newline with instead.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { hasHardwareKeyboard } from "./keyboard";

function stubPointer(fine: boolean): void {
  vi.stubGlobal("window", {
    matchMedia: (query: string) => ({ matches: fine && query.includes("fine") }),
  });
}

describe("detecting a hardware keyboard", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("says yes to a trackpad or mouse", () => {
    stubPointer(true);
    expect(hasHardwareKeyboard()).toBe(true);
  });

  it("says no to a touchscreen", () => {
    stubPointer(false);
    expect(hasHardwareKeyboard()).toBe(false);
  });

  it("says no rather than throwing where matchMedia is missing", () => {
    vi.stubGlobal("window", {});
    expect(hasHardwareKeyboard()).toBe(false);
  });
});
