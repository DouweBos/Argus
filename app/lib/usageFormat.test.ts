import type { UsageLimitWindow } from "./types";
import { describe, expect, it } from "vitest";
import {
  formatCountdown,
  limitTone,
  paceLabel,
  percentLeft,
  resetHint,
} from "./usageFormat";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

function limitWindow(over: Partial<UsageLimitWindow>): UsageLimitWindow {
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

describe("percentLeft", () => {
  it("rounds and clamps", () => {
    expect(percentLeft(27.4)).toBe(73);
    expect(percentLeft(120)).toBe(0);
    expect(percentLeft(-5)).toBe(100);
  });
});

describe("formatCountdown", () => {
  it("shows hours and minutes inside a day", () => {
    expect(formatCountdown(4 * HOUR + 29 * MINUTE)).toBe("4h 29m");
    expect(formatCountdown(2 * HOUR)).toBe("2h");
  });

  it("drops minutes once it is days away", () => {
    expect(formatCountdown(5 * DAY + HOUR + 30 * MINUTE)).toBe("5d 1h");
    expect(formatCountdown(3 * DAY + 10 * MINUTE)).toBe("3d");
  });

  it("handles the last stretch", () => {
    expect(formatCountdown(12 * MINUTE)).toBe("12m");
    expect(formatCountdown(20_000)).toBe("<1m");
    expect(formatCountdown(0)).toBeNull();
  });
});

describe("resetHint", () => {
  it("counts down to the reset", () => {
    expect(resetHint(1_000 + 90 * MINUTE, 1_000)).toBe("Resets in 1h 30m");
  });

  it("says nothing without a reset time", () => {
    expect(resetHint(null, 0)).toBeNull();
  });

  it("covers a reset that has already passed", () => {
    expect(resetHint(0, MINUTE)).toBe("Resetting now");
  });
});

describe("paceLabel", () => {
  it("names each pace", () => {
    expect(paceLabel("ahead")).toBe("Ahead of pace");
    expect(paceLabel("on")).toBe("On pace");
    expect(paceLabel("under")).toBe("Under pace");
    expect(paceLabel(null)).toBeNull();
  });
});

describe("limitTone", () => {
  it("escalates with use and with a fast pace", () => {
    expect(limitTone(limitWindow({ used_percent: 20 }))).toBe("accent");
    expect(limitTone(limitWindow({ used_percent: 20, pace: "ahead" }))).toBe(
      "warning",
    );
    expect(limitTone(limitWindow({ used_percent: 80 }))).toBe("warning");
    expect(limitTone(limitWindow({ used_percent: 95 }))).toBe("danger");
  });
});
