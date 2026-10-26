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

  it("parses the cost and tokens tabs with a default range", () => {
    const cost = parseRoute("/usage/cost");
    expect(cost.usageTab).toBe("cost");
    expect(cost.usageRange).toBe("30d");
    expect(parseRoute("/usage/tokens").usageTab).toBe("tokens");
  });

  it("reads the range from the query and ignores one it does not know", () => {
    expect(parseRoute("/usage/cost?range=7d").usageRange).toBe("7d");
    expect(parseRoute("/usage/tokens?range=1y").usageRange).toBe("30d");
  });

  it("has no range off the cost and tokens tabs", () => {
    expect(parseRoute("/usage").usageRange).toBeNull();
    expect(parseRoute("/usage?range=7d").usageRange).toBeNull();
    expect(parseRoute("/inbox").usageRange).toBeNull();
  });

  it("keeps the default range off the URL", () => {
    expect(routeToPath({ view: "usage", usageTab: "cost" })).toBe(
      "/usage/cost",
    );
    expect(
      routeToPath({ view: "usage", usageTab: "cost", usageRange: "30d" }),
    ).toBe("/usage/cost");
    expect(
      routeToPath({ view: "usage", usageTab: "limits", usageRange: "7d" }),
    ).toBe("/usage");
  });

  it("round-trips a range alongside the focused host", () => {
    const path = "/usage/tokens?range=24h&host=mini";
    expect(routeToPath(parseRoute(path))).toBe(path);
  });

  it("reports tab patterns for telemetry", () => {
    expect(routePattern("/usage/cost")).toBe("/usage/cost");
    expect(routePattern("/usage/tokens")).toBe("/usage/tokens");
  });
});
