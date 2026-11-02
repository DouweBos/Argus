import type {
  ClaudeAccountLimits,
  ClaudeUsageSummary,
} from "@argus/remote-protocol";
import { describe, expect, it } from "vitest";
import { usageAccountViews, usagePlan, usageSummaryView } from "./usageViews";

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
    expect(view.caption).toBe("3 sessions · API estimate");
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

  it("flags an empty range and a missing price list", () => {
    const view = usageSummaryView(
      summary({ sessions: 0, prices_fetched_at: null }),
      "cost",
    );
    expect(view.empty).toBe(true);
    expect(view.pricesPending).toBe(true);
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
