import { describe, expect, it } from "vitest";
import {
  deleteFraction,
  deleteProgressLabel,
  setupFraction,
  truncateStart,
} from "./sessionProgress";

describe("setupFraction", () => {
  it("is null until the step count is known", () => {
    expect(setupFraction(undefined)).toBeNull();
    expect(setupFraction({ current: 0, total: 0, item: "x" })).toBeNull();
  });

  it("does not count the step that is still running", () => {
    expect(setupFraction({ current: 1, total: 4, item: "x" })).toBe(0);
    expect(setupFraction({ current: 4, total: 4, item: "x" })).toBe(0.75);
  });
});

describe("deleteFraction", () => {
  it("is null before the first count", () => {
    expect(deleteFraction(undefined)).toBeNull();
    expect(deleteFraction({ current: 0, total: 0 })).toBeNull();
  });

  it("is the share of items already gone", () => {
    expect(deleteFraction({ current: 30, total: 120 })).toBe(0.25);
    expect(deleteFraction({ current: 130, total: 120 })).toBe(1);
  });
});

describe("deleteProgressLabel", () => {
  it("falls back to a generic label without counts", () => {
    expect(deleteProgressLabel(undefined)).toBe("Removing files…");
  });

  it("names the counts", () => {
    expect(deleteProgressLabel({ current: 3, total: 12 })).toBe(
      "3 of 12 items removed",
    );
  });
});

describe("truncateStart", () => {
  it("keeps the tail of a long string", () => {
    expect(truncateStart("apps/mobile/node_modules", 8)).toBe("…modules");
    expect(truncateStart("short", 8)).toBe("short");
  });
});
