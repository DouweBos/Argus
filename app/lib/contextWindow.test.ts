import { describe, expect, it } from "vitest";
import { contextLimitForModel } from "./contextWindow";

// Mirrors the capability list the Claude Code CLI reports in its initialize
// handshake (values + descriptions taken verbatim).
const MODELS = [
  {
    value: "default",
    displayName: "Default (recommended)",
    description: "Opus 4.8 with 1M context · Best for everyday, complex tasks",
  },
  {
    value: "opus[1m]",
    displayName: "Opus (1M context)",
    description: "Opus 4.8 with 1M context · Best for everyday, complex tasks",
  },
  {
    value: "sonnet",
    displayName: "Sonnet",
    description: "Sonnet 4.6 · Efficient for routine tasks",
  },
  {
    value: "opus",
    displayName: "Opus",
    description: "Opus 4.8 · Best for everyday, complex tasks",
  },
];

describe("contextLimitForModel", () => {
  it("detects 1M via the [1m] variant suffix alone", () => {
    expect(contextLimitForModel("opus[1m]", null)).toBe(1_000_000);
  });

  it("detects 1M from a matched capability description", () => {
    expect(contextLimitForModel("default", MODELS)).toBe(1_000_000);
  });

  it("keeps 200k for an explicit non-1M variant", () => {
    expect(contextLimitForModel("opus", MODELS)).toBe(200_000);
    expect(contextLimitForModel("sonnet", MODELS)).toBe(200_000);
  });

  it("falls back to the default entry for a resumed, unmatched resolved id", () => {
    // Resume strips the [1m] suffix, leaving only the resolved id which
    // matches no capability value — should inherit the default window (1M).
    expect(contextLimitForModel("claude-opus-4-8", MODELS)).toBe(1_000_000);
  });

  it("defaults to 200k when nothing is known", () => {
    expect(contextLimitForModel("claude-opus-4-8", null)).toBe(200_000);
    expect(contextLimitForModel(undefined, [])).toBe(200_000);
  });
});
