/**
 * The cron evaluator, including the two cases a naive "add 24 hours"
 * implementation gets wrong: the spring-forward gap and the fall-back repeat.
 */

import { describe, expect, it } from "vitest";
import { computeNextRun, isValidCron, parseCron } from "./cron";

const UTC = "UTC";
const AMS = "Europe/Amsterdam";

function at(iso: string): number {
  return Date.parse(iso);
}

describe("parseCron", () => {
  it("accepts the five-field grammar", () => {
    const fields = parseCron("*/15 0-4 1,15 * 1-5");
    expect([...fields.minute]).toEqual([0, 15, 30, 45]);
    expect([...fields.hour]).toEqual([0, 1, 2, 3, 4]);
    expect([...fields.dayOfMonth]).toEqual([1, 15]);
    expect([...fields.dayOfWeek]).toEqual([1, 2, 3, 4, 5]);
    expect(fields.domRestricted).toBe(true);
    expect(fields.dowRestricted).toBe(true);
  });

  it("treats 7 and 0 as the same Sunday", () => {
    expect([...parseCron("0 0 * * 7").dayOfWeek]).toEqual([0]);
  });

  it.each([
    ["too few fields", "0 0 * *"],
    ["out of range minute", "60 0 * * *"],
    ["out of range month", "0 0 * 13 *"],
    ["inverted range", "0 5-1 * * *"],
    ["zero step", "*/0 * * * *"],
    ["garbage", "every minute please"],
  ])("rejects %s", (_label, expression) => {
    expect(() => parseCron(expression)).toThrow();
    expect(isValidCron(expression)).toBe(false);
  });
});

describe("computeNextRun", () => {
  it.each([
    [
      "every minute",
      "* * * * *",
      UTC,
      "2026-03-01T10:00:30Z",
      "2026-03-01T10:01:00Z",
    ],
    [
      "step values",
      "*/15 * * * *",
      UTC,
      "2026-03-01T10:16:00Z",
      "2026-03-01T10:30:00Z",
    ],
    [
      "step values wrapping the hour",
      "*/15 * * * *",
      UTC,
      "2026-03-01T10:46:00Z",
      "2026-03-01T11:00:00Z",
    ],
    [
      "an hour step",
      "0 */6 * * *",
      UTC,
      "2026-03-01T07:00:00Z",
      "2026-03-01T12:00:00Z",
    ],
    [
      "a weekday range skipping the weekend",
      "30 7 * * 1-5",
      UTC,
      "2026-03-06T08:00:00Z", // Friday, after the fire
      "2026-03-09T07:30:00Z", // Monday
    ],
    [
      "a list of minutes",
      "0,30 9 * * *",
      UTC,
      "2026-03-01T09:00:00Z",
      "2026-03-01T09:30:00Z",
    ],
    [
      "a yearly expression",
      "0 0 1 1 *",
      UTC,
      "2026-06-01T00:00:00Z",
      "2027-01-01T00:00:00Z",
    ],
    [
      "a fixed wall-clock time in a zone",
      "30 7 * * *",
      AMS,
      "2026-01-10T12:00:00Z",
      "2026-01-11T06:30:00Z", // 07:30 CET
    ],
  ])("handles %s", (_label, expression, tz, from, expected) => {
    expect(computeNextRun(expression, tz, at(from))).toBe(at(expected));
  });

  it("keeps wall-clock time across the spring-forward shift", () => {
    // 2026-03-29, Amsterdam clocks go 02:00 → 03:00.
    const before = at("2026-03-28T06:30:00Z"); // 07:30 CET, that day's fire
    const next = computeNextRun("30 7 * * *", AMS, before);
    expect(next).toBe(at("2026-03-29T05:30:00Z")); // 07:30 CEST — still 07:30
  });

  it("resolves a time inside the spring-forward gap to the moment the clock jumps", () => {
    const before = at("2026-03-28T01:30:00Z"); // 02:30 CET
    const next = computeNextRun("30 2 * * *", AMS, before);
    // 02:30 local does not exist on the 29th; it lands at 03:30 CEST.
    expect(next).toBe(at("2026-03-29T01:30:00Z"));
  });

  it("keeps wall-clock time across the fall-back shift", () => {
    // 2026-10-25, Amsterdam clocks go 03:00 → 02:00.
    const before = at("2026-10-24T05:30:00Z"); // 07:30 CEST
    const next = computeNextRun("30 7 * * *", AMS, before);
    expect(next).toBe(at("2026-10-25T06:30:00Z")); // 07:30 CET
  });

  it("fires only once through a repeated hour", () => {
    // 02:30 happens twice on 2026-10-25. Only the standard-time occurrence
    // counts, so the schedule fires once and moves to the next day.
    const first = computeNextRun("30 2 * * *", AMS, at("2026-10-24T12:00:00Z"));
    expect(first).toBe(at("2026-10-25T01:30:00Z")); // 02:30 CET

    const second = computeNextRun("30 2 * * *", AMS, first as number);
    expect(second).toBe(at("2026-10-26T01:30:00Z")); // next day, 02:30 CET
  });

  it("returns null for a date that never comes round", () => {
    expect(
      computeNextRun("0 0 30 2 *", UTC, at("2026-01-01T00:00:00Z")),
    ).toBeNull();
  });
});
