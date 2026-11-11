import type {
  ClaudeUsageSummary,
  UsageRunnerRow,
} from "@argus/remote-protocol";
import { describe, expect, it } from "vitest";
import { METRICS } from "./summaryMetric";
import { modelLabel, usageChartSeries, usageRunnerViews } from "./usageRunners";

function row(runner: string, cost: number[], priced = true): UsageRunnerRow {
  return {
    runner,
    label: runner.toUpperCase(),
    sessions: 1,
    tokens: cost.reduce((a, b) => a + b, 0) * 10,
    cost_usd: priced ? cost.reduce((a, b) => a + b, 0) : 0,
    priced,
    series: cost.map((c, i) => ({
      start: i,
      tokens: c * 10,
      cost_usd: priced ? c : 0,
    })),
  };
}

function data(runners: UsageRunnerRow[]): ClaudeUsageSummary {
  return {
    range: "7d",
    since: 0,
    until: 0,
    bucket: "day",
    sessions: runners.length,
    tokens: {
      processed: 0,
      input: 0,
      cache_read: 0,
      cache_write: 0,
      output: 0,
    },
    cost: { total: 0, input: 0, cache_read: 0, cache_write: 0, output: 0 },
    cache_savings_usd: 0,
    series: [
      { start: 0, tokens: 0, cost_usd: 0 },
      { start: 1, tokens: 0, cost_usd: 0 },
    ],
    models: [],
    runners,
    prices_fetched_at: 1,
  };
}

describe("usageChartSeries", () => {
  it("is null for old hosts and a single runner", () => {
    expect(
      usageChartSeries({ ...data([]), runners: undefined }, METRICS.cost),
    ).toBeNull();
    expect(usageChartSeries(data([row("a", [1, 2])]), METRICS.cost)).toBeNull();
  });

  it("leaves out runners with nothing to draw on this metric", () => {
    const runners = [row("a", [1, 2]), row("b", [3, 4], false)];
    expect(usageChartSeries(data(runners), METRICS.cost)).toBeNull();
    expect(usageChartSeries(data(runners), METRICS.tokens)).toEqual([
      { label: "B", values: [30, 40], other: false },
      { label: "A", values: [10, 20], other: false },
    ]);
  });

  it("folds runners past the fourth into Other runners", () => {
    const runners = [5, 4, 3, 2, 1, 1].map((n, i) =>
      row(`r${String(i)}`, [n, 0]),
    );
    const series = usageChartSeries(data(runners), METRICS.cost);
    expect(series?.map((s) => s.label)).toEqual([
      "R0",
      "R1",
      "R2",
      "R3",
      "Other runners",
    ]);
    expect(series?.[4]).toEqual({
      label: "Other runners",
      values: [2, 0],
      other: true,
    });
  });

  it("pads a short runner series to the summary's buckets", () => {
    const short = { ...row("a", [1]), series: [] };
    expect(
      usageChartSeries(
        data([short, row("b", [1, 1]), row("c", [2, 2])]),
        METRICS.cost,
      ),
    ).toEqual([
      { label: "C", values: [2, 2], other: false },
      { label: "B", values: [1, 1], other: false },
    ]);
  });
});

describe("usageRunnerViews", () => {
  it("dashes an unpriced runner's cost and sorts it last", () => {
    const views = usageRunnerViews(
      [row("a", [0, 0], false), row("b", [2, 2])],
      METRICS.cost,
      4,
    );
    expect(views.map((v) => [v.id, v.cost, v.share, v.progress])).toEqual([
      ["b", "$4.00", "100%", 1],
      ["a", "—", "—", 0],
    ]);
  });
});

describe("modelLabel", () => {
  const runners = [row("claude", [1]), row("codex", [1])];

  it("names the runner only when there are several", () => {
    const model = { model: "gpt-5", tokens: 1, cost_usd: 1, priced: true };
    expect(modelLabel({ ...model, runner: "codex" }, runners)).toBe(
      "gpt-5 · CODEX",
    );
    expect(modelLabel({ ...model, runner: "codex" }, runners.slice(0, 1))).toBe(
      "gpt-5",
    );
    expect(modelLabel(model, runners)).toBe("gpt-5");
    expect(modelLabel({ ...model, runner: "grok" }, runners)).toBe(
      "gpt-5 · grok",
    );
  });
});
