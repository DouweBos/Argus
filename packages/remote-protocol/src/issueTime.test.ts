import { describe, expect, it } from "vitest";
import { shortDuration, timeInStatus } from "./issueTime";

const DAY = 86_400_000;

describe("timeInStatus", () => {
  it("sums each status's time, including returns to it", () => {
    const stints = timeInStatus(
      [
        { name: "Triage", type: "triage", enteredAt: 0 },
        { name: "Todo", type: "unstarted", enteredAt: 5 * DAY },
        { name: "In Progress", type: "started", enteredAt: 7 * DAY },
        { name: "Todo", type: "unstarted", enteredAt: 8 * DAY },
      ],
      10 * DAY,
    );
    expect(stints.map((s) => [s.name, s.duration / DAY])).toEqual([
      ["Triage", 5],
      ["Todo", 4],
      ["In Progress", 1],
    ]);
  });
});

describe("shortDuration", () => {
  it("uses Linear's short units", () => {
    expect(shortDuration(5 * DAY)).toBe("5d");
    expect(shortDuration(300 * DAY)).toBe("10mo");
    expect(shortDuration(30_000)).toBe("<1m");
  });
});
