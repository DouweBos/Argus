import type { RateTable } from "./pricing";
import type { UsageRecord } from "./transcriptRecords";
import type { UsagePriceOverride } from "@argus/remote-protocol";
import { describe, expect, it } from "vitest";
import { bucketStarts, summarize } from "./summary";

const NOW = new Date(2026, 9, 26, 15, 30).getTime();
const table: RateTable = new Map([
  [
    "claude-opus-5-5",
    {
      input: 4e-6,
      output: 2e-5,
      cacheRead: 2e-7,
      cacheWrite: 5e-6,
      cacheWrite1h: 8e-6,
    },
  ],
]);

const rec = (over: Partial<UsageRecord>): UsageRecord => ({
  at: NOW - 60_000,
  runner: "claude-code",
  model: "claude-opus-5-5",
  sessionId: "s1",
  key: "m1:r1",
  input: 10,
  cacheRead: 1000,
  cacheWrite5m: 100,
  cacheWrite1h: 50,
  output: 20,
  costUsd: null,
  ...over,
});

describe("bucketStarts", () => {
  it("gives 24 hours or N local days ending now", () => {
    const hours = bucketStarts("24h", NOW);
    expect(hours).toHaveLength(24);
    expect(hours.at(-1)).toBeLessThanOrEqual(NOW);
    const days = bucketStarts("7d", NOW);
    expect(days).toHaveLength(7);
    expect(new Date(days[6]).getDate()).toBe(26);
    expect(new Date(days[0]).getHours()).toBe(0);
  });
});

describe("summarize", () => {
  it("dedupes repeated records and prices each kind of token", () => {
    const s = summarize(
      [rec({}), rec({}), rec({ key: "m2:r2", sessionId: "s2" })],
      table,
      "7d",
      NOW,
    );
    expect(s.sessions).toBe(2);
    expect(s.tokens).toEqual({
      processed: 2360,
      input: 20,
      cache_read: 2000,
      cache_write: 300,
      output: 40,
    });
    const one = 10 * 4e-6 + 1000 * 2e-7 + 100 * 5e-6 + 50 * 8e-6 + 20 * 2e-5;
    expect(s.cost.total).toBeCloseTo(2 * one, 12);
    expect(s.cache_savings_usd).toBeCloseTo(2 * 1000 * (4e-6 - 2e-7), 12);
    expect(s.series.at(-1)?.tokens).toBe(2360);
    expect(s.models).toHaveLength(1);
    expect(s.models[0]).toMatchObject({
      model: "claude-opus-5-5",
      tokens: 2360,
      cost_usd: s.cost.total,
      priced: true,
      runner: "claude-code",
      price_source: "list",
      token_kinds: s.tokens,
    });
    expect(s.models[0].series?.at(-1)).toMatchObject({ tokens: 2360 });
    expect(s.models[0].series).toHaveLength(7);
    expect(s.speeds).toBeUndefined();
  });

  it("splits by runner and prefers a runner's reported cost", () => {
    const s = summarize(
      [
        rec({ key: null }),
        rec({ runner: "codex", model: "gpt-x", key: null, sessionId: "c1" }),
        rec({
          runner: "gemini",
          model: "gemini-y",
          key: null,
          sessionId: "g1",
          costUsd: 0.5,
        }),
        rec({
          runner: "gemini",
          model: "claude-opus-5-5",
          key: null,
          costUsd: 1,
        }),
      ],
      table,
      "24h",
      NOW,
      (id) => id.toUpperCase(),
    );
    const runners = Object.fromEntries(
      (s.runners ?? []).map((r) => [r.runner, r]),
    );
    expect(Object.keys(runners).sort()).toEqual([
      "claude-code",
      "codex",
      "gemini",
    ]);
    expect(runners.gemini).toMatchObject({ label: "GEMINI", sessions: 2 });
    expect(runners.gemini.cost_usd).toBeCloseTo(1.5, 12);
    expect(runners.codex).toMatchObject({ cost_usd: 0, priced: false });
    expect(runners["claude-code"].series.at(-1)?.tokens).toBe(1180);
    // Reported spend without a list rate can't be split by kind.
    expect(s.cost.other).toBeCloseTo(0.5, 12);
    const one = 10 * 4e-6 + 1000 * 2e-7 + 100 * 5e-6 + 50 * 8e-6 + 20 * 2e-5;
    expect(s.cost.total).toBeCloseTo(one + 1.5, 12);
    expect(
      s.cost.input + s.cost.cache_read + s.cost.cache_write + s.cost.output,
    ).toBeCloseTo(one + 1, 12);
    expect(s.sessions).toBe(4);
  });

  it("counts unknown models without cost and drops records outside the range", () => {
    const s = summarize(
      [
        rec({ model: "claude-future-9", key: null }),
        rec({ at: NOW - 30 * 86_400_000, key: "old" }),
      ],
      table,
      "7d",
      NOW,
    );
    expect(s.tokens.processed).toBe(1180);
    expect(s.cost.total).toBe(0);
    expect(s.models[0]).toMatchObject({
      model: "claude-future-9",
      priced: false,
    });
  });
});

const one = 10 * 4e-6 + 1000 * 2e-7 + 100 * 5e-6 + 50 * 8e-6 + 20 * 2e-5;

describe("summarize with speed tiers", () => {
  const fastTable: RateTable = new Map([
    [
      "claude-opus-5-5",
      {
        ...table.get("claude-opus-5-5")!,
        fast: {
          input: 8e-6,
          output: 4e-5,
          cacheRead: 4e-7,
          cacheWrite: 1e-5,
          cacheWrite1h: 1.6e-5,
        },
      },
    ],
    [
      "gpt-x",
      {
        input: 1e-6,
        output: 1e-5,
        cacheRead: 1e-7,
        cacheWrite: 1e-6,
        cacheWrite1h: 1e-6,
      },
    ],
  ]);

  it("prices fast requests at their tier and reports the premium", () => {
    const s = summarize(
      [rec({ key: "a" }), rec({ key: "b", speed: "fast" })],
      fastTable,
      "7d",
      NOW,
    );
    expect(s.cost.total).toBeCloseTo(3 * one, 12);
    expect(s.cost.premium).toBeCloseTo(one, 12);
    expect(
      s.cost.input + s.cost.cache_read + s.cost.cache_write + s.cost.output,
    ).toBeCloseTo(3 * one, 12);
    expect(s.speeds?.map((r) => r.speed)).toEqual(["standard", "fast"]);
    expect(s.speeds?.[1].premium_usd).toBeCloseTo(one, 12);
    expect(s.speeds?.[1].cost_usd).toBeCloseTo(2 * one, 12);
  });

  it("falls back to the provider's multiple when the list has no tier", () => {
    const s = summarize(
      [rec({ key: null, runner: "codex", model: "gpt-x", speed: "fast" })],
      fastTable,
      "7d",
      NOW,
    );
    const standard = 10 * 1e-6 + 1000 * 1e-7 + 150 * 1e-6 + 20 * 1e-5;
    expect(s.cost.total).toBeCloseTo(2 * standard, 12);
    expect(s.cost.premium).toBeCloseTo(standard, 12);
  });

  it("scales the premium with a runner's reported cost", () => {
    const s = summarize(
      [rec({ key: null, speed: "fast", costUsd: 1 })],
      fastTable,
      "7d",
      NOW,
    );
    expect(s.cost.total).toBeCloseTo(1, 12);
    expect(s.cost.premium).toBeCloseTo(0.5, 12);
  });
});

describe("summarize with hand-set prices", () => {
  const custom = (
    model: string,
    over: Partial<UsagePriceOverride> = {},
  ): UsagePriceOverride => ({
    model,
    input_per_mtok: 1,
    output_per_mtok: 2,
    cache_read_per_mtok: null,
    cache_write_per_mtok: null,
    map_to: null,
    ...over,
  });

  it("replaces the list price, cache rates falling back to input", () => {
    const s = summarize([rec({ key: null })], table, "7d", NOW, undefined, {
      overrides: [custom("claude-opus-5-5")],
    });
    expect(s.cost.total).toBeCloseTo((10 + 1000 + 150) * 1e-6 + 20 * 2e-6, 12);
    expect(s.models[0].price_source).toBe("custom");
  });

  it("wins over a runner's reported cost; the list price doesn't", () => {
    const reported = rec({ key: null, costUsd: 5 });
    expect(summarize([reported], table, "7d", NOW).cost.total).toBe(5);
    const s = summarize([reported], table, "7d", NOW, undefined, {
      overrides: [
        custom("claude-opus-5-5", { input_per_mtok: 0, output_per_mtok: 0 }),
      ],
    });
    expect(s.cost.total).toBe(0);
    expect(s.models[0]).toMatchObject({ price_source: "custom", priced: true });
  });

  it("moves a mapped model's tokens and cost onto its target", () => {
    const s = summarize(
      [
        rec({ key: null }),
        rec({ key: null, model: "opus-preview-x" }),
        rec({ key: null, model: "mystery" }),
      ],
      table,
      "7d",
      NOW,
      undefined,
      { overrides: [custom("opus-preview-x", { map_to: "claude-opus-5-5" })] },
    );
    expect(s.models.map((m) => m.model)).toEqual([
      "claude-opus-5-5",
      "mystery",
    ]);
    expect(s.models[0]).toMatchObject({
      tokens: 2360,
      mapped_from: ["opus-preview-x"],
      price_source: "list",
    });
    expect(s.models[0].cost_usd).toBeCloseTo(2 * one, 12);
    expect(s.models[1]).toMatchObject({ price_source: "none", priced: false });
  });

  it("labels reported cost without a price as reported", () => {
    const s = summarize(
      [rec({ key: null, runner: "gemini", model: "gemini-y", costUsd: 0.2 })],
      table,
      "7d",
      NOW,
    );
    expect(s.models[0]).toMatchObject({
      price_source: "reported",
      priced: true,
    });
  });
});

describe("summarize with a model filter", () => {
  const records = [
    rec({ key: null }),
    rec({ key: null, runner: "codex", model: "gpt-x" }),
    rec({ key: null, runner: "gemini", model: "gpt-x" }),
  ];

  it("counts only included models, scoped by runner", () => {
    const s = summarize(records, table, "7d", NOW, undefined, {
      filter: { include: [{ runner: "codex", model: "GPT-X" }], exclude: [] },
    });
    expect(s.models.map((m) => [m.runner, m.model])).toEqual([
      ["codex", "gpt-x"],
    ]);
  });

  it("leaves excluded models out before mapping", () => {
    const s = summarize(records, table, "7d", NOW, undefined, {
      filter: { include: [], exclude: [{ runner: null, model: "gpt-x" }] },
      overrides: [
        {
          model: "gpt-x",
          input_per_mtok: null,
          output_per_mtok: null,
          cache_read_per_mtok: null,
          cache_write_per_mtok: null,
          map_to: "claude-opus-5-5",
        },
      ],
    });
    expect(s.tokens.processed).toBe(1180);
    expect(s.models[0].mapped_from).toBeUndefined();
  });
});
