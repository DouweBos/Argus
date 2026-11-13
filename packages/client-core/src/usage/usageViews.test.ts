import type {
  ClaudeAccountLimits,
  ClaudeUsageSummary,
  RunnerUsageLimits,
  UsageRunnerRow,
} from "@argus/remote-protocol";
import { describe, expect, it } from "vitest";
import {
  usageAccountViews,
  usagePlan,
  usageRunnerLimitViews,
  usageSummaryView,
} from "./usageViews";

const HOUR = 3_600_000;

function account(over: Partial<ClaudeAccountLimits>): ClaudeAccountLimits {
  return {
    account_id: "a",
    label: "Work",
    status: "ok",
    subscription_type: "max",
    checked_at: 0,
    windows: [
      {
        id: "five_hour",
        kind: "session",
        label: "Session",
        used_percent: 80,
        resets_at: 2 * HOUR,
        window_minutes: 300,
        pace: "ahead",
      },
    ],
    ...over,
  };
}

describe("usageAccountViews", () => {
  it("fills the bar with the used share and labels what is left", () => {
    const [view] = usageAccountViews({ accounts: [account({})] }, 0);
    expect(view.state).toBe("ok");
    expect(view.stale).toBe(false);
    expect(view.windows[0]).toEqual({
      id: "five_hour",
      label: "Session",
      value: "20% left",
      progress: 0.8,
      tone: "warning",
      hint: "Resets in 2h",
      aside: "Ahead of pace",
    });
  });

  it("clamps an overspent window to a full bar", () => {
    const [view] = usageAccountViews(
      {
        accounts: [
          account({
            windows: [{ ...account({}).windows[0], used_percent: 130 }],
          }),
        ],
      },
      0,
    );
    expect(view.windows[0].progress).toBe(1);
    expect(view.windows[0].value).toBe("0% left");
    expect(view.windows[0].tone).toBe("danger");
  });

  it("tells failed, empty, unsupported and stale apart", () => {
    const views = usageAccountViews(
      {
        accounts: [
          account({ account_id: "1", status: "failed", windows: [] }),
          account({ account_id: "2", status: "ok", windows: [] }),
          account({ account_id: "3", status: "unsupported", windows: [] }),
          account({ account_id: "4", status: "failed" }),
        ],
      },
      0,
    );
    expect(views.map((v) => [v.state, v.stale])).toEqual([
      ["failed", false],
      ["none", false],
      ["unsupported", false],
      ["ok", true],
    ]);
  });

  it("names the plan only for a single account", () => {
    expect(usagePlan({ accounts: [account({})] })).toBe("max");
    expect(
      usagePlan({ accounts: [account({}), account({ account_id: "b" })] }),
    ).toBeNull();
    expect(usagePlan(null)).toBeNull();
    expect(
      usagePlan({ accounts: [account({})], runners: [runner({})] }),
    ).toBeNull();
  });
});

function runner(over: Partial<RunnerUsageLimits>): RunnerUsageLimits {
  return {
    runner: "codex",
    label: "Codex",
    status: "ok",
    plan: "plus",
    message: null,
    checked_at: 0,
    windows: account({}).windows,
    ...over,
  };
}

describe("usageRunnerLimitViews", () => {
  it("is empty for hosts that predate runners", () => {
    expect(usageRunnerLimitViews({ accounts: [] }, 0)).toEqual([]);
  });

  it("shapes a runner's windows like an account's", () => {
    const [view] = usageRunnerLimitViews(
      { accounts: [], runners: [runner({})] },
      0,
    );
    expect(view).toMatchObject({
      id: "codex",
      label: "Codex",
      plan: "plus",
      state: "ok",
      stale: false,
      message: null,
    });
    expect(view.windows[0].value).toBe("20% left");
  });

  it("says why windows are missing, in the runner's words when it gave some", () => {
    const views = usageRunnerLimitViews(
      {
        accounts: [],
        runners: [
          runner({ runner: "a", status: "unsupported", windows: [] }),
          runner({
            runner: "b",
            status: "unsupported",
            message: "Signed in with an API key",
            windows: [],
          }),
          runner({
            runner: "c",
            label: "Cursor",
            status: "failed",
            windows: [],
          }),
          runner({
            runner: "d",
            status: "failed",
            message: "Timed out",
            windows: [],
          }),
          runner({ runner: "e", status: "failed" }),
        ],
      },
      0,
    );
    expect(views.map((v) => [v.state, v.message, v.stale])).toEqual([
      ["unsupported", "No plan limits", false],
      ["unsupported", "Signed in with an API key", false],
      ["failed", "Cursor didn't answer the limits check.", false],
      ["failed", "Timed out", false],
      ["ok", null, true],
    ]);
  });
});

function summary(over: Partial<ClaudeUsageSummary>): ClaudeUsageSummary {
  return {
    range: "30d",
    since: 0,
    until: 0,
    bucket: "day",
    sessions: 3,
    tokens: {
      processed: 1_500_000,
      input: 500_000,
      cache_read: 800_000,
      cache_write: 100_000,
      output: 100_000,
    },
    cost: { total: 10, input: 2, cache_read: 1, cache_write: 3, output: 4 },
    cache_savings_usd: 5,
    series: [{ start: 0, tokens: 1_500_000, cost_usd: 10 }],
    models: [
      { model: "haiku", tokens: 100, cost_usd: 1, priced: true },
      { model: "opus", tokens: 1_000_000, cost_usd: 9, priced: true },
      { model: "mystery", tokens: 5, cost_usd: 0, priced: false },
    ],
    prices_fetched_at: 1,
    ...over,
  };
}

describe("usageSummaryView", () => {
  it("leads with cost, largest model first, unpriced last", () => {
    const view = usageSummaryView(summary({}), "cost");
    expect(view.headline).toBe("$10.00");
    expect(view.caption).toBe(
      "3 sessions · estimated at API prices where agents don’t report their own",
    );
    expect(view.models.map((m) => m.model)).toEqual([
      "opus",
      "haiku",
      "mystery",
    ]);
    expect(view.models[2]).toMatchObject({ cost: "—", share: "—" });
    expect(view.hasUnpriced).toBe(true);
    expect(view.parts.segments[3]).toMatchObject({
      label: "Output",
      display: "$4.00",
      detail: "40%",
    });
  });

  it("keys the same layout on tokens", () => {
    const view = usageSummaryView(summary({ sessions: 1 }), "tokens");
    expect(view.headline).toBe("1.50M");
    expect(view.caption).toBe("1 session · processed tokens");
    expect(view.pricesPending).toBe(false);
    expect(view.chart.caption).toBe("Daily processed tokens");
  });

  it("splits by speed and names the premium only when a fast tier ran", () => {
    const plain = usageSummaryView(
      summary({
        speeds: [
          { speed: "standard", tokens: 1, cost_usd: 10, premium_usd: 0 },
        ],
      }),
      "cost",
    );
    expect(plain.speeds).toEqual([]);
    expect(plain.totals.map((t) => t.label)).not.toContain("Premium");

    const fast = usageSummaryView(
      summary({
        cost: {
          total: 10,
          input: 2,
          cache_read: 1,
          cache_write: 3,
          output: 4,
          premium: 3,
        },
        speeds: [
          { speed: "fast", tokens: 500, cost_usd: 6, premium_usd: 3 },
          { speed: "standard", tokens: 1000, cost_usd: 4, premium_usd: 0 },
        ],
      }),
      "cost",
    );
    expect(fast.speeds.map((s) => [s.label, s.share, s.premium])).toEqual([
      ["Standard", "40%", null],
      ["Fast", "60%", "+$3.00 premium"],
    ]);
    expect(fast.totals.at(-1)).toEqual({ label: "Premium", value: "$3.00" });
    const tokens = usageSummaryView(
      summary({
        cost: {
          total: 10,
          input: 2,
          cache_read: 1,
          cache_write: 3,
          output: 4,
          premium: 3,
        },
      }),
      "tokens",
    );
    expect(tokens.totals.map((t) => t.label)).not.toContain("Premium");
  });

  it("flags an empty range and a missing price list", () => {
    const view = usageSummaryView(
      summary({ sessions: 0, prices_fetched_at: null }),
      "cost",
    );
    expect(view.empty).toBe(true);
    expect(view.pricesPending).toBe(true);
  });

  it("adds an Other cost part only when some cost can't be split", () => {
    expect(
      usageSummaryView(summary({}), "cost").parts.segments.map((p) => p.label),
    ).not.toContain("Other");
    const view = usageSummaryView(
      summary({
        cost: {
          total: 12,
          input: 2,
          cache_read: 1,
          cache_write: 3,
          output: 4,
          other: 2,
        },
      }),
      "cost",
    );
    expect(view.parts.segments[4]).toMatchObject({
      label: "Other",
      display: "$2.00",
      detail: "16.7%",
      other: true,
    });
    expect(usageSummaryView(summary({}), "tokens").parts.segments).toHaveLength(
      4,
    );
  });

  it("keeps the single chart and plain model names for one runner", () => {
    const view = usageSummaryView(
      summary({ runners: [runnerRow({})] }),
      "cost",
    );
    expect(view.chart.series).toBeNull();
    expect(view.runners).toHaveLength(1);
    expect(view.models[0].model).toBe("opus");
  });

  it("splits by runner once there are two", () => {
    const view = usageSummaryView(
      summary({
        models: [
          {
            model: "opus",
            tokens: 900,
            cost_usd: 8,
            priced: true,
            runner: "claude",
          },
          {
            model: "opus",
            tokens: 100,
            cost_usd: 1,
            priced: true,
            runner: "opencode",
          },
          {
            model: "local",
            tokens: 50,
            cost_usd: 0,
            priced: false,
            runner: "opencode",
          },
        ],
        runners: [
          runnerRow({}),
          runnerRow({
            runner: "opencode",
            label: "OpenCode",
            sessions: 1,
            tokens: 150,
            cost_usd: 1,
            series: [{ start: 0, tokens: 150, cost_usd: 1 }],
          }),
        ],
      }),
      "cost",
    );
    expect(view.chart.series).toEqual([
      { label: "Claude Code", values: [9], other: false },
      { label: "OpenCode", values: [1], other: false },
    ]);
    expect(
      view.runners.map((r) => [r.label, r.sessions, r.cost, r.share]),
    ).toEqual([
      ["Claude Code", "2 sessions", "$9.00", "90%"],
      ["OpenCode", "1 session", "$1.00", "10%"],
    ]);
    expect(view.models.map((m) => [m.id, m.model])).toEqual([
      ["claude:opus", "opus · Claude Code"],
      ["opencode:opus", "opus · OpenCode"],
      ["opencode:local", "local · OpenCode"],
    ]);
  });

  it("draws long ranges as a line", () => {
    const series = Array.from({ length: 90 }, (_, i) => ({
      start: i,
      tokens: 1,
      cost_usd: 1,
    }));
    expect(usageSummaryView(summary({ series }), "cost").chart.kind).toBe(
      "line",
    );
  });
});

function runnerRow(over: Partial<UsageRunnerRow>): UsageRunnerRow {
  return {
    runner: "claude",
    label: "Claude Code",
    sessions: 2,
    tokens: 1_000_000,
    cost_usd: 9,
    priced: true,
    series: [{ start: 0, tokens: 1_000_000, cost_usd: 9 }],
    ...over,
  };
}
