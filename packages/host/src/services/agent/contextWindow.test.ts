import { describe, expect, it } from "vitest";
import { contextWindowFromModelUsage } from "./contextWindow";

describe("contextWindowFromModelUsage", () => {
  it("reads the main model's window", () => {
    expect(
      contextWindowFromModelUsage(
        {
          "claude-haiku-4-5": { contextWindow: 200_000 },
          "claude-opus-5-5": { contextWindow: 1_000_000 },
        },
        "claude-haiku-4-5",
      ),
    ).toBe(200_000);
  });

  it("takes the largest window when the main model isn't known", () => {
    expect(
      contextWindowFromModelUsage({
        "claude-haiku-4-5": { contextWindow: 200_000 },
        "claude-opus-5-5": { contextWindow: 1_000_000 },
      }),
    ).toBe(1_000_000);
  });

  it("is null when nothing reports a window", () => {
    expect(contextWindowFromModelUsage(undefined)).toBeNull();
    expect(contextWindowFromModelUsage({ x: { inputTokens: 3 } })).toBeNull();
  });
});
