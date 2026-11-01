import { describe, expect, it } from "vitest";
import { INITIAL_LOAD, loadPhase } from "./loadPhase";

// Same cases as ArgusCore's LoadPhaseTests.
describe("loadPhase", () => {
  it("is loading until a load answers", () => {
    expect(loadPhase(INITIAL_LOAD, true)).toEqual({ kind: "loading" });
  });

  it("is empty once a load answered with nothing", () => {
    expect(loadPhase({ loaded: true, error: null }, true)).toEqual({
      kind: "empty",
    });
  });

  it("fails when there is nothing to show and the load failed", () => {
    expect(loadPhase({ loaded: true, error: "boom" }, true)).toEqual({
      kind: "failed",
      error: "boom",
    });
  });

  it("keeps rows on screen over a failed refresh", () => {
    expect(loadPhase({ loaded: true, error: "boom" }, false)).toEqual({
      kind: "content",
    });
    expect(loadPhase(INITIAL_LOAD, false)).toEqual({ kind: "content" });
  });
});
