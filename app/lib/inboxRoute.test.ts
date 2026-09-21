/**
 * The inbox is a URL like any other screen — it has to survive back/forward,
 * a tab restore, and being pointed at another host.
 */

import { describe, expect, it } from "vitest";
import { parseRoute, routePattern, routeToPath } from "./router";

describe("inbox route", () => {
  it("parses /inbox", () => {
    const route = parseRoute("/inbox");
    expect(route.view).toBe("inbox");
    expect(route.sessionId).toBeNull();
  });

  it("round-trips through the path builder", () => {
    expect(routeToPath(parseRoute("/inbox"))).toBe("/inbox");
  });

  it("carries the focused host", () => {
    const route = parseRoute("/inbox?host=mini");
    expect(route.view).toBe("inbox");
    expect(route.hostId).toBe("mini");
    expect(routeToPath(route)).toBe("/inbox?host=mini");
  });

  it("reports a clean pattern for telemetry", () => {
    expect(routePattern("/inbox")).toBe("/inbox");
  });

  it("ignores segments below it — the inbox has no sub-screens", () => {
    expect(parseRoute("/inbox/nonsense").view).toBe("inbox");
  });
});
