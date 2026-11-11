import type { RateTable } from "./pricing";
import type { UsageRecord } from "./transcriptRecords";
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
    expect(s.models).toEqual([
      {
        model: "claude-opus-5-5",
        tokens: 2360,
        cost_usd: s.cost.total,
        priced: true,
        runner: "claude-code",
      },
    ]);
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
