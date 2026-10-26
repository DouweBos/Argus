/**
 * The usage screen's tab lives in the URL, with plan limits owning bare `/usage`.
 */

import { describe, expect, it } from "vitest";
import { parseRoute, routePattern, routeToPath } from "./router";

describe("usage route", () => {
  it("parses /usage onto the limits tab", () => {
    const route = parseRoute("/usage");
    expect(route.view).toBe("usage");
    expect(route.usageTab).toBe("limits");
  });

  it("keeps limits on the bare path", () => {
    expect(routeToPath({ view: "usage", usageTab: "limits" })).toBe("/usage");
    expect(routeToPath(parseRoute("/usage"))).toBe("/usage");
  });

  it("falls back to limits for a tab it does not know", () => {
    const route = parseRoute("/usage/nonsense");
    expect(route.view).toBe("usage");
    expect(route.usageTab).toBe("limits");
  });

  it("carries the focused host", () => {
    expect(routeToPath(parseRoute("/usage?host=mini"))).toBe(
      "/usage?host=mini",
    );
  });

  it("reports a clean pattern for telemetry", () => {
    expect(routePattern("/usage")).toBe("/usage");
  });

  it("leaves other views without a tab", () => {
    expect(parseRoute("/inbox").usageTab).toBeNull();
    expect(parseRoute("/sessions/abc").usageTab).toBeNull();
  });
});
