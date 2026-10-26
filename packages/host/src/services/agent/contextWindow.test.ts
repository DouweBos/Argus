import { describe, expect, it } from "vitest";
import {
  contextWindowFromModelUsage,
  guessContextWindow,
} from "./contextWindow";

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

describe("guessContextWindow", () => {
  it("gives [1m] variants and the Claude 5 family 1M", () => {
    expect(guessContextWindow("opus[1m]")).toBe(1_000_000);
    expect(guessContextWindow("claude-opus-5-5")).toBe(1_000_000);
    expect(guessContextWindow("claude-sonnet-5")).toBe(1_000_000);
    expect(guessContextWindow("claude-fable-5-1")).toBe(1_000_000);
  });

  it("gives older Claude models 200k and leaves other ids alone", () => {
    expect(guessContextWindow("claude-haiku-4-5-20251001")).toBe(200_000);
    expect(guessContextWindow("claude-3-5-sonnet-20241022")).toBe(200_000);
    expect(guessContextWindow("gpt-5")).toBeNull();
    expect(guessContextWindow(null)).toBeNull();
  });
});
