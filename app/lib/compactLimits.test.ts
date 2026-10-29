import type { ClaudeAccountLimits, UsageLimitWindow } from "./types";
import { describe, expect, it } from "vitest";
import { compactLimits, worstTone } from "./compactLimits";

const NOW = 1_000_000;

function win(over: Partial<UsageLimitWindow>): UsageLimitWindow {
  return {
    id: "five_hour",
    kind: "session",
    label: "Session",
    used_percent: 10,
    resets_at: null,
    window_minutes: 300,
    pace: null,
    ...over,
  };
}

function account(
  id: string,
  windows: UsageLimitWindow[],
  status: ClaudeAccountLimits["status"] = "ok",
): ClaudeAccountLimits {
  return {
    account_id: id,
    label: id,
    status,
    subscription_type: null,
    windows,
    checked_at: NOW,
  };
}

describe("compactLimits", () => {
  it("is empty without data or windows", () => {
    expect(compactLimits(null, NOW)).toEqual([]);
    expect(
      compactLimits({ accounts: [account("a", [], "unsupported")] }, NOW),
    ).toEqual([]);
  });

  it("lists every window of a single account", () => {
    const limits = compactLimits(
      {
        accounts: [
          account("a", [
            win({ used_percent: 27, resets_at: NOW + 60 * 60_000 }),
            win({ id: "seven_day", label: "Weekly", used_percent: 92 }),
          ]),
        ],
      },
      NOW,
    );
    expect(limits).toEqual([
      {
        id: "a:five_hour",
        label: "Session",
        value: "73% left",
        progress: 0.27,
        tone: "accent",
        title: "Resets in 1h",
      },
      {
        id: "a:seven_day",
        label: "Weekly",
        value: "8% left",
        progress: 0.92,
        tone: "danger",
        title: undefined,
      },
    ]);
  });

  it("keeps each account's tightest window when there are several", () => {
    const limits = compactLimits(
      {
        accounts: [
          account("a", [
            win({ used_percent: 20 }),
            win({ id: "seven_day", label: "Weekly", used_percent: 80 }),
          ]),
          account("b", [win({ used_percent: 5 })]),
        ],
      },
      NOW,
    );
    expect(limits.map((l) => [l.id, l.label])).toEqual([
      ["a", "a · Weekly"],
      ["b", "b · Session"],
    ]);
    expect(worstTone(limits)).toBe("warning");
  });
});
