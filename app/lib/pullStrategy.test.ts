import { describe, expect, it } from "vitest";
import { pullStrategyFromConfig } from "./pullStrategy";

describe("pullStrategyFromConfig", () => {
  it("merges when nothing is set", () => {
    expect(pullStrategyFromConfig(null, null)).toBe("merge");
    expect(pullStrategyFromConfig("false", null)).toBe("merge");
  });

  it("rebases for any rebase mode", () => {
    expect(pullStrategyFromConfig("true", null)).toBe("rebase");
    expect(pullStrategyFromConfig("merges", null)).toBe("rebase");
  });

  it("lets pull.ff=only win", () => {
    expect(pullStrategyFromConfig("true", "only")).toBe("ff-only");
  });
});
