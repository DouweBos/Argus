import { describe, expect, it } from "vitest";
import { normalizeModelKey, parsePriceDocument, rateFor } from "./pricing";
import { ratesAt } from "./speedPricing";

const doc = {
  "claude-opus-5-5": {
    input_cost_per_token: 4e-6,
    output_cost_per_token: 2e-5,
    cache_read_input_token_cost: 2e-7,
    cache_creation_input_token_cost: 5e-6,
    cache_creation_input_token_cost_above_1hr: 8e-6,
  },
  "claude-fast-1": {
    input_cost_per_token: 5e-6,
    output_cost_per_token: 2.5e-5,
    cache_read_input_token_cost: 5e-7,
    provider_specific_entry: { fast: 2 },
  },
  "gpt-tiered": {
    input_cost_per_token: 1e-6,
    output_cost_per_token: 1e-5,
    cache_read_input_token_cost: 1e-7,
    input_cost_per_token_priority: 2e-6,
    output_cost_per_token_priority: 2e-5,
    cache_read_input_token_cost_priority: 2e-7,
    input_cost_per_token_ultrafast: 3e-6,
    output_cost_per_token_ultrafast: 3e-5,
  },
  "claude-haiku-4-5": {
    input_cost_per_token: 1e-6,
    output_cost_per_token: 5e-6,
  },
  "anthropic/claude-sonnet-5": {
    input_cost_per_token: 2e-6,
    output_cost_per_token: 1e-5,
  },
  "claude-broken": { input_cost_per_token: 1e-6 },
  "gpt-5": { input_cost_per_token: 1e-6, output_cost_per_token: 1e-5 },
  "xai/grok-4": { input_cost_per_token: 3e-6, output_cost_per_token: 1.5e-5 },
  "azure/gpt-5": { input_cost_per_token: 9e-6, output_cost_per_token: 9e-5 },
  "text-embedding-3-small": {
    mode: "embedding",
    input_cost_per_token: 2e-8,
    output_cost_per_token: 0,
  },
  sample_spec: { note: "not a model" },
};

describe("parsePriceDocument", () => {
  const table = new Map(Object.entries(parsePriceDocument(doc)));

  it("keeps chat models with input and output rates", () => {
    expect([...table.keys()].sort()).toEqual([
      "claude-fast-1",
      "claude-haiku-4-5",
      "claude-opus-5-5",
      "claude-sonnet-5",
      "gpt-5",
      "gpt-tiered",
      "grok-4",
    ]);
  });

  it("prefers the bare id over a provider-prefixed one", () => {
    expect(table.get("gpt-5")?.input).toBe(1e-6);
  });

  it("falls back to the input rate for unlisted cache rates", () => {
    expect(table.get("claude-haiku-4-5")).toEqual({
      input: 1e-6,
      output: 5e-6,
      cacheRead: 1e-6,
      cacheWrite: 1e-6,
      cacheWrite1h: 1e-6,
    });
    expect(table.get("claude-opus-5-5")?.cacheWrite1h).toBe(8e-6);
  });

  it("resolves dated, bracketed and placeholder model ids", () => {
    expect(rateFor(table, "claude-haiku-4-5-20251001")?.input).toBe(1e-6);
    expect(rateFor(table, "Claude-Opus-5-5[1m]")?.output).toBe(2e-5);
    expect(rateFor(table, "<synthetic>")).toBeNull();
    expect(rateFor(table, "opus")).toBeNull();
    expect(normalizeModelKey("anthropic/claude-x[1m]")).toBe("claude-x");
  });
});

describe("speed tiers", () => {
  const table = new Map(Object.entries(parsePriceDocument(doc)));

  it("scales Anthropic's listed fast multiple", () => {
    expect(table.get("claude-fast-1")?.fast).toEqual({
      input: 1e-5,
      output: 5e-5,
      cacheRead: 1e-6,
      cacheWrite: 1e-5,
      cacheWrite1h: 1e-5,
    });
  });

  it("reads priority and ultrafast rates, keeping unlisted cache ratios", () => {
    const rate = table.get("gpt-tiered");
    expect(rate?.fast).toMatchObject({ input: 2e-6, cacheRead: 2e-7 });
    expect(rate?.ultrafast?.output).toBe(3e-5);
    expect(rate?.ultrafast?.cacheRead).toBeCloseTo(3e-7, 15);
    expect(table.get("gpt-5")?.fast).toBeUndefined();
  });

  it("prices each speed, falling back to the provider multiple", () => {
    const opus = table.get("claude-opus-5-5")!;
    expect(ratesAt(opus, "standard", "claude-opus-5-5")).toBe(opus);
    expect(ratesAt(opus, "fast", "claude-opus-5-5").output).toBeCloseTo(
      4e-5,
      15,
    );
    const tiered = table.get("gpt-tiered")!;
    expect(ratesAt(tiered, "ultrafast", "gpt-tiered").input).toBe(3e-6);
    const gpt = table.get("gpt-5")!;
    expect(ratesAt(gpt, "ultrafast", "gpt-5").input).toBeCloseTo(2e-6, 15);
    const grok = table.get("grok-4")!;
    expect(ratesAt(grok, "fast", "grok-4")).toBe(grok);
  });
});
