import { describe, expect, it } from "vitest";
import {
  applyRateLimitEvent,
  paceFor,
  windowsFromUsageResponse,
} from "./limitWindows";

const NOW = Date.parse("2026-10-26T15:00:00Z");

const response = {
  subscription_type: "max",
  rate_limits_available: true,
  rate_limits: {
    five_hour: {
      utilization: 34,
      resets_at: "2026-10-26T16:50:00.113321+00:00",
    },
    seven_day: { utilization: 2, resets_at: "2026-11-02T05:00:00+00:00" },
    seven_day_opus: null,
    extra_usage: { is_enabled: false },
    limits: [
      {
        kind: "session",
        percent: 34,
        resets_at: "2026-10-26T16:50:00Z",
        scope: null,
      },
      {
        kind: "weekly_scoped",
        percent: 7,
        resets_at: "2026-11-02T05:00:00+00:00",
        scope: { model: { id: null, display_name: "Fable" } },
      },
    ],
    spend: {
      enabled: false,
      used: { amount_minor: 0, currency: "USD", exponent: 2 },
      limit: null,
    },
  },
};

describe("windowsFromUsageResponse", () => {
  it("maps session, weekly and scoped weekly windows", () => {
    const parsed = windowsFromUsageResponse(response, NOW);
    expect(parsed.available).toBe(true);
    expect(parsed.subscriptionType).toBe("max");
    expect(parsed.windows.map((w) => [w.id, w.label, w.used_percent])).toEqual([
      ["five_hour", "Session", 34],
      ["seven_day", "Weekly", 2],
      ["seven_day_fable", "Weekly · Fable", 7],
    ]);
    expect(parsed.windows[0].resets_at).toBe(
      Date.parse("2026-10-26T16:50:00.113Z"),
    );
  });

  it("prefers model_scoped over the limits list", () => {
    const parsed = windowsFromUsageResponse(
      {
        ...response,
        rate_limits: {
          ...response.rate_limits,
          model_scoped: [
            { display_name: "Opus", utilization: 12, resets_at: null },
          ],
        },
      },
      NOW,
    );
    expect(parsed.windows.map((w) => w.id)).toEqual([
      "five_hour",
      "seven_day",
      "seven_day_opus",
    ]);
  });

  it("reports monthly spend only when it is switched on", () => {
    const parsed = windowsFromUsageResponse(
      {
        ...response,
        rate_limits: {
          ...response.rate_limits,
          spend: {
            enabled: true,
            used: { amount_minor: 2500, currency: "USD", exponent: 2 },
            limit: { amount_minor: 10000, currency: "USD", exponent: 2 },
          },
        },
      },
      NOW,
    );
    expect(parsed.windows.at(-1)).toMatchObject({
      id: "monthly_spend",
      kind: "monthly",
      used_percent: 25,
      pace: null,
    });
  });

  it("is unavailable without rate limits", () => {
    expect(
      windowsFromUsageResponse({ rate_limits_available: false }, NOW),
    ).toEqual({
      available: false,
      subscriptionType: null,
      windows: [],
    });
  });
});

describe("paceFor", () => {
  const fiveHours = 300;
  it("compares used share against elapsed share", () => {
    // Half the window gone.
    const resetsAt = NOW + 150 * 60_000;
    expect(paceFor(50, resetsAt, fiveHours, NOW)).toBe("on");
    expect(paceFor(70, resetsAt, fiveHours, NOW)).toBe("ahead");
    expect(paceFor(20, resetsAt, fiveHours, NOW)).toBe("under");
    expect(paceFor(20, null, fiveHours, NOW)).toBeNull();
  });
});

describe("applyRateLimitEvent", () => {
  const { windows } = windowsFromUsageResponse(response, NOW);

  it("updates a fixed window from a streamed event", () => {
    const line = JSON.stringify({
      type: "rate_limit_event",
      rate_limit_info: {
        rateLimitType: "five_hour",
        utilization: 0.5,
        resetsAt: NOW / 1000 + 3600,
      },
    });
    const next = applyRateLimitEvent(windows, line, NOW);
    expect(next?.find((w) => w.id === "five_hour")).toMatchObject({
      used_percent: 50,
      resets_at: NOW + 3_600_000,
    });
    expect(next).toHaveLength(windows.length);
  });

  it("matches the scoped event to the probed cap", () => {
    const line = JSON.stringify({
      type: "rate_limit_event",
      rate_limit_info: {
        rateLimitType: "seven_day_overage_included",
        utilization: 0.2,
      },
    });
    expect(
      applyRateLimitEvent(windows, line, NOW)?.find(
        (w) => w.id === "seven_day_fable",
      )?.used_percent,
    ).toBe(20);
  });

  it("ignores other lines", () => {
    expect(
      applyRateLimitEvent(windows, '{"type":"assistant"}', NOW),
    ).toBeNull();
    expect(applyRateLimitEvent(windows, "not json", NOW)).toBeNull();
  });
});
