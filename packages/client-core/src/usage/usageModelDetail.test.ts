import type { ClaudeUsageSummary, UsageModelRow } from "@argus/remote-protocol";
import { describe, expect, it } from "vitest";
import {
  cacheHitRate,
  findUsageModel,
  usageModelDetailView,
  usageModelKey,
} from "./usageModelDetail";

const DAY = 86_400_000;

const opus: UsageModelRow = {
  model: "claude-opus-4-5",
  tokens: 2_000_000,
  cost_usd: 10,
  priced: true,
  runner: "claude-code",
  price_source: "custom",
  mapped_from: ["opus-preview"],
  token_kinds: {
    processed: 2_000_000,
    input: 100_000,
    cache_read: 1_500_000,
    cache_write: 400_000,
    output: 0,
  },
  series: [
    { start: 0, tokens: 1_000_000, cost_usd: 4 },
    { start: DAY, tokens: 1_000_000, cost_usd: 6 },
  ],
};

const local: UsageModelRow = {
  model: "local",
  tokens: 500,
  cost_usd: 0,
  priced: false,
};

const summary: ClaudeUsageSummary = {
  range: "7d",
  since: 0,
  until: 2 * DAY,
  bucket: "day",
  sessions: 3,
  tokens: {
    processed: 4_000_000,
    input: 0,
    cache_read: 0,
    cache_write: 0,
    output: 0,
  },
  cost: { total: 20, input: 0, cache_read: 0, cache_write: 0, output: 0 },
  cache_savings_usd: 0,
  series: [],
  models: [opus, local],
  runners: [
    {
      runner: "claude-code",
      label: "Claude Code",
      sessions: 3,
      tokens: 4_000_000,
      cost_usd: 20,
      priced: true,
      series: [],
    },
  ],
  prices_fetched_at: 1,
};

describe("usageModelDetailView", () => {
  it("finds rows by runner, defaulting old rows to Claude Code", () => {
    expect(findUsageModel(summary, usageModelKey(opus))).toBe(opus);
    expect(usageModelKey(local).runner).toBe("claude-code");
    expect(findUsageModel(summary, usageModelKey(local))).toBe(local);
    expect(
      findUsageModel(summary, { runner: "codex", model: "local" }),
    ).toBeNull();
  });

  it("reads cache hits over all input", () => {
    expect(cacheHitRate(opus)).toBe(0.75);
    expect(cacheHitRate(local)).toBeNull();
  });

  it("shows the model's trend, rate and price source", () => {
    const view = usageModelDetailView(summary, opus, "cost");
    expect(view.headline).toBe("$10.00");
    expect(view.caption).toBe("50% of the range");
    expect(view.chart?.values).toEqual([4, 6]);
    expect(view.runner).toBe("Claude Code");
    expect(view.stats).toEqual([
      { label: "Cost", value: "$10.00" },
      { label: "Tokens", value: "2.00M" },
      { label: "Cache hit rate", value: "75%" },
      { label: "Per million tokens", value: "$5.00" },
      { label: "Price", value: "Your price" },
    ]);
    expect(view.mappedFrom).toEqual(["opus-preview"]);
    expect(view.unpriced).toBe(false);
  });

  it("offers a price for a model without one", () => {
    const view = usageModelDetailView(summary, local, "cost");
    expect(view.unpriced).toBe(true);
    expect(view.headline).toBe("—");
    expect(view.chart).toBeNull();
  });
});
