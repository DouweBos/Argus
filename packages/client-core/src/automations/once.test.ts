import { describe, expect, it } from "vitest";
import {
  defaultOnceAt,
  formatLocalDateTime,
  onceError,
  onceInstant,
  parseLocalDateTime,
} from "./once";

const AMS = "Europe/Amsterdam";

describe("one-time trigger clock", () => {
  it("parses only real wall-clock times", () => {
    expect(parseLocalDateTime("2026-11-10T09:00")).toEqual({
      year: 2026,
      month: 11,
      day: 10,
      hour: 9,
      minute: 0,
    });
    expect(parseLocalDateTime("2026-02-30T09:00")).toBeNull();
    expect(parseLocalDateTime("2026-11-10 09:00")).toBeNull();
    expect(parseLocalDateTime("2026-11-10T24:00")).toBeNull();
  });

  it("reads the time in the trigger's zone", () => {
    expect(onceInstant("2026-11-10T09:00", AMS)).toBe(
      Date.parse("2026-11-10T08:00:00Z"),
    );
    expect(onceInstant("2026-07-10T09:00", AMS)).toBe(
      Date.parse("2026-07-10T07:00:00Z"),
    );
    expect(onceInstant("soon", AMS)).toBeNull();
  });

  it("round-trips through the zone", () => {
    const instant = Date.parse("2026-11-10T08:00:00Z");
    expect(formatLocalDateTime(instant, AMS)).toBe("2026-11-10T09:00");
  });

  it("rejects a time already gone", () => {
    const now = Date.parse("2026-11-10T08:30:00Z");
    expect(onceError("2026-11-10T09:00", AMS, now)).toMatch(/passed/);
    expect(onceError("2026-11-10T10:00", AMS, now)).toBeNull();
    expect(onceError("", AMS, now)).toMatch(/Pick/);
  });

  it("defaults to the next whole hour", () => {
    const now = Date.parse("2026-11-10T08:30:00Z");
    expect(defaultOnceAt(AMS, now)).toBe("2026-11-10T10:00");
  });
});
