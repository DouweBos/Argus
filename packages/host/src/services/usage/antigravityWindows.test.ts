import { describe, expect, it } from "vitest";
import {
  antigravityModelWindows,
  antigravitySummaryWindows,
} from "./antigravityWindows";

const NOW = Date.UTC(2026, 10, 11, 12);
const MIN = 60_000;
const iso = (ms: number) => new Date(ms).toISOString();

describe("antigravitySummaryWindows", () => {
  it("labels buckets by family and window, skipping disabled ones", () => {
    const windows = antigravitySummaryWindows(
      {
        groups: [
          {
            displayName: "Models",
            buckets: [
              {
                bucketId: "gemini-pro-5h",
                window: "5h",
                remainingFraction: 0.25,
                resetTime: iso(NOW + 60 * MIN),
              },
              {
                bucketId: "3p-weekly",
                window: "weekly",
                remainingFraction: 0.75,
                resetTime: iso(NOW + 3 * 24 * 60 * MIN),
              },
              { bucketId: "gemini-off", disabled: true, remainingFraction: 0 },
            ],
          },
          {
            displayName: "Deep Think",
            buckets: [
              {
                bucketId: "gemini-argon-daily",
                displayName: "Daily",
                remainingFraction: 1.4,
              },
            ],
          },
        ],
      },
      NOW,
      NOW,
    );
    expect(windows.map((w) => [w.id, w.kind, w.label, w.used_percent])).toEqual(
      [
        ["gemini-pro-5h", "session", "Gemini · Session", 75],
        ["3p-weekly", "weekly", "Claude & GPT · Weekly", 25],
        ["gemini-argon-daily", "session", "Deep Think · Daily", 0],
      ],
    );
    expect(windows[0]).toMatchObject({
      resets_at: NOW + 60 * MIN,
      window_minutes: 300,
    });
    expect(windows[2]).toMatchObject({ resets_at: null, window_minutes: null });
  });

  it("drops the rolling reset of an untouched bucket and reads ungrouped buckets", () => {
    const windows = antigravitySummaryWindows(
      {
        groups: [],
        buckets: [
          {
            bucketId: "gemini-5h",
            window: "5h",
            remainingFraction: 1,
            resetTime: iso(NOW + 300 * MIN + 5_000),
          },
        ],
      },
      NOW,
      NOW,
    );
    expect(windows).toMatchObject([
      { id: "gemini-5h", used_percent: 0, resets_at: null },
    ]);
    expect(antigravitySummaryWindows(null, NOW, NOW)).toEqual([]);
  });
});

describe("antigravityModelWindows", () => {
  it("keeps the most-used model per family", () => {
    const windows = antigravityModelWindows(
      {
        models: {
          "gemini-3-pro": {
            quotaInfo: { remainingFraction: 0.8 },
            weeklyQuotaInfo: {
              remainingFraction: 0.5,
              resetTime: iso(NOW + 24 * 60 * MIN),
            },
          },
          "gemini-3-flash": { quotaInfo: { remainingFraction: 0.4 } },
          "claude-sonnet": {
            modelProvider: "MODEL_PROVIDER_ANTHROPIC",
            quotaInfo: { remainingFraction: 1 },
          },
          "some-other": { quotaInfo: { remainingFraction: 0 } },
        },
      },
      NOW,
    );
    expect(windows.map((w) => [w.id, w.label, w.used_percent])).toEqual([
      ["gemini-quota", "Gemini · Quota", 60],
      ["gemini-weekly", "Gemini · Weekly", 50],
      ["claude-quota", "Claude · Quota", 0],
    ]);
    expect(windows[1]).toMatchObject({ kind: "weekly", window_minutes: 10080 });
  });
});
