import { describe, expect, it } from "vitest";
import { isFallback } from "./links";

describe("isFallback", () => {
  it("flags routes this client opens the parent of", () => {
    expect(isFallback("/pull-requests/o/r/1")).toBe(true);
    expect(isFallback("/usage/cost")).toBe(true);
    expect(isFallback("/devices/web/tab-1")).toBe(true);
  });

  it("leaves the screens it has alone", () => {
    expect(isFallback("/")).toBe(false);
    expect(isFallback("/?agent=a1")).toBe(false);
    expect(isFallback("/devices")).toBe(false);
    expect(isFallback("/devices/ios/ABC")).toBe(false);
    expect(isFallback("/sessions/s1/agents/a1?host=h")).toBe(false);
    expect(isFallback("/projects/0123456789abcdef")).toBe(false);
    expect(isFallback("/inbox/proposals/p1")).toBe(false);
    expect(isFallback("/automations/describe")).toBe(false);
    expect(isFallback("/automations/quick/runs/r1")).toBe(false);
  });
});
