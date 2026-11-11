import { describe, expect, it } from "vitest";
import { codexWindows, cursorWindows, grokWindows } from "./runnerWindows";

const NOW = Date.UTC(2026, 10, 11, 12);
const MIN = 60_000;

describe("codexWindows", () => {
  it("reads the session and weekly windows from a rate-limit read", () => {
    const parsed = codexWindows(
      {
        rateLimits: {
          primary: {
            usedPercent: 61,
            windowDurationMins: 300,
            resetsAt: (NOW + 60 * MIN) / 1000,
          },
          secondary: {
            usedPercent: 23,
            windowDurationMins: 10080,
            resetsAt: null,
          },
          planType: "pro",
        },
      },
      NOW,
    );
    expect(parsed.plan).toBe("pro");
    expect(parsed.windows).toMatchObject([
      {
        id: "primary",
        kind: "session",
        label: "Session",
        used_percent: 61,
        resets_at: NOW + 60 * MIN,
        pace: "under",
      },
      { id: "secondary", kind: "weekly", label: "Weekly", resets_at: null },
    ]);
  });

  it("prefers the codex limit and skips empty windows", () => {
    const parsed = codexWindows(
      {
        rateLimits: { primary: { usedPercent: 99 }, planType: "unknown" },
        rateLimitsByLimitId: { codex: { primary: null, secondary: null } },
      },
      NOW,
    );
    expect(parsed).toEqual({ windows: [], plan: null });
  });
});

describe("cursorWindows", () => {
  it("gives a monthly window per pool, resetting at the cycle's end", () => {
    const end = NOW + 10 * 24 * 60 * MIN;
    const windows = cursorWindows(
      {
        billingCycleStart: String(end - 30 * 24 * 60 * MIN),
        billingCycleEnd: String(end),
        planUsage: { totalPercentUsed: 40, apiPercentUsed: 12.5 },
      },
      NOW,
    );
    expect(windows.map((w) => [w.id, w.label, w.used_percent])).toEqual([
      ["total", "Monthly", 40],
      ["api", "Monthly · API", 12.5],
    ]);
    expect(windows[0]).toMatchObject({
      kind: "monthly",
      resets_at: end,
      window_minutes: 30 * 24 * 60,
    });
  });
});

describe("grokWindows", () => {
  it("reads the subscription period, treating a missing percentage as unused", () => {
    const windows = grokWindows(
      {
        config: {
          currentPeriod: {
            type: "USAGE_PERIOD_TYPE_WEEKLY",
            start: "2026-11-09T00:00:00Z",
            end: "2026-11-16T00:00:00Z",
          },
        },
      },
      NOW,
    );
    expect(windows).toMatchObject([
      {
        id: "subscription",
        kind: "weekly",
        used_percent: 0,
        window_minutes: 10080,
      },
    ]);
    expect(grokWindows({}, NOW)).toEqual([]);
  });
});
