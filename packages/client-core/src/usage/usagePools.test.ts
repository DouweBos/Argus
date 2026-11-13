import type { UsageLimitWindow } from "@argus/remote-protocol";
import { describe, expect, it } from "vitest";
import { type PoolAccount, usagePoolViews } from "./usagePools";

const HOUR = 3_600_000;

function win(over: Partial<UsageLimitWindow>): UsageLimitWindow {
  return {
    id: "five_hour",
    kind: "session",
    label: "Session",
    used_percent: 0,
    resets_at: null,
    window_minutes: 300,
    pace: null,
    ...over,
  };
}

function weekly(used: number, resetsAt: number | null = 72 * HOUR) {
  return win({
    id: "seven_day",
    kind: "weekly",
    label: "Weekly",
    used_percent: used,
    resets_at: resetsAt,
  });
}

function acct(
  id: string,
  windows: UsageLimitWindow[],
  plan: string | null = "max",
): PoolAccount {
  return { id, label: id, plan, windows };
}

describe("usagePoolViews", () => {
  it("leaves a single account to its own meters", () => {
    expect(usagePoolViews([acct("a", [win({})])], 0)).toBeNull();
    expect(usagePoolViews([acct("a", [win({})]), acct("b", [])], 0)).toBeNull();
  });

  it("averages what is left and fills each segment with its used share", () => {
    const [session] = usagePoolViews(
      [
        acct("a", [win({ used_percent: 80, resets_at: 2 * HOUR })]),
        acct("b", [win({ used_percent: 20, resets_at: 4 * HOUR })]),
      ],
      0,
    )!;
    expect(session.value).toBe("50% left");
    expect(session.progress).toBeCloseTo(0.5);
    expect(session.segments.map((s) => s.used)).toEqual([0.8, 0.2]);
  });

  it("orders columns by the soonest session reset, the same on every card", () => {
    const pools = usagePoolViews(
      [
        acct("late", [win({ resets_at: 4 * HOUR }), weekly(10)]),
        acct("none", [win({ resets_at: null }), weekly(10)]),
        acct("soon", [win({ resets_at: HOUR }), weekly(10)]),
      ],
      0,
    )!;
    for (const pool of pools) {
      expect(pool.segments.map((s) => s.accountId)).toEqual([
        "soon",
        "late",
        "none",
      ]);
    }
  });

  it("leaves a gap where an account lacks the window", () => {
    const pools = usagePoolViews(
      [
        acct("a", [win({ used_percent: 50 }), weekly(40)]),
        acct("b", [win({ used_percent: 10 })]),
      ],
      0,
    )!;
    const week = pools.find((p) => p.id === "seven_day")!;
    expect(week.segments.map((s) => s.present)).toEqual([true, false]);
    // Only accounts with the window count toward its pool.
    expect(week.value).toBe("60% left");
  });

  it("counts a spent weekly cap as nothing left in the session", () => {
    const [session] = usagePoolViews(
      [
        acct("a", [win({ used_percent: 10, resets_at: HOUR }), weekly(100)]),
        acct("b", [win({ used_percent: 0, resets_at: 2 * HOUR }), weekly(0)]),
      ],
      0,
    )!;
    expect(session.segments[0]).toMatchObject({ accountId: "a", used: 1 });
    expect(session.value).toBe("50% left");
    // Its session comes back when the week does, not in an hour.
    expect(session.segments[0]?.resetHint).toBe("Resets in 3d");
  });

  it("says what the next reset gives back and hatches that segment", () => {
    const [session] = usagePoolViews(
      [
        acct("Work", [win({ used_percent: 60, resets_at: 2 * HOUR })]),
        acct("Home", [win({ used_percent: 20, resets_at: 5 * HOUR })]),
      ],
      0,
    )!;
    expect(session.next).toBe("Work resets in 2h, giving back 30% of the pool");
    expect(session.segments.map((s) => s.restoring)).toEqual([true, false]);
    expect(session.segments[0]?.detail).toBe(
      "Work · max · 40% left · Resets in 2h",
    );
  });

  it("says nothing about a reset when none is known", () => {
    const [session] = usagePoolViews(
      [acct("a", [win({ used_percent: 50 })]), acct("b", [win({})])],
      0,
    )!;
    expect(session.next).toBeNull();
    expect(session.segments.every((s) => !s.restoring)).toBe(true);
  });
});
