import { describe, expect, it } from "vitest";
import { easHostIdOf, easStartMessage, isBillableEasStart } from "./easBilling";

describe("isBillableEasStart", () => {
  it("is a billable start only for a stopped EAS slot", () => {
    expect(isBillableEasStart("eas:eh0123abcd:1", false)).toBe(true);
    expect(isBillableEasStart("eas:eh0123abcd:1", true)).toBe(false);
    expect(isBillableEasStart("A1B2-C3D4", false)).toBe(false);
    expect(isBillableEasStart("rh01234567:A1B2", false)).toBe(false);
  });

  it("reads the host id", () => {
    expect(easHostIdOf("eas:eh0123abcd:12")).toBe("eh0123abcd");
    expect(easHostIdOf("eas:eh0123abcd")).toBeNull();
  });
});

describe("easStartMessage", () => {
  it("names the host's limits when known", () => {
    expect(
      easStartMessage({ idleMinutes: 10, maxSessionMinutes: 30 }),
    ).toContain("idle for 10 min, or it reaches its 30 min limit");
    expect(easStartMessage(null)).toContain("reaches its time limit");
  });
});
