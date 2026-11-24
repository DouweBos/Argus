import { describe, expect, it } from "vitest";
import { handoffBlock, MAX_HANDOFF_DEPTH } from "./teammateTools";

describe("teammate hand-offs", () => {
  it("never comes back round to a teammate already asked", () => {
    expect(handoffBlock(["a", "b"], "a")).toContain("already part");
  });

  it("stops at the depth limit", () => {
    const chain = Array.from({ length: MAX_HANDOFF_DEPTH }, (_, i) => `t${i}`);

    expect(handoffBlock(chain, "new")).toContain("deep");
    expect(handoffBlock(chain.slice(1), "new")).toBeNull();
  });
});
