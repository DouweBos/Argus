/**
 * The automations screens are three URLs, not one screen with local state —
 * which automation and which run you are looking at has to survive a
 * back/forward and a tab restore.
 */

import { describe, expect, it } from "vitest";
import { parseRoute, routePattern, routeToPath } from "./router";

describe("automations routes", () => {
  it("parses the list", () => {
    const route = parseRoute("/automations");
    expect(route.view).toBe("automations");
    expect(route.automationId).toBeNull();
    expect(route.automationRunId).toBeNull();
  });

  it("parses one automation", () => {
    const route = parseRoute("/automations/a-1");
    expect(route.view).toBe("automations");
    expect(route.automationId).toBe("a-1");
    expect(route.automationRunId).toBeNull();
  });

  it("parses one run of one automation", () => {
    const route = parseRoute("/automations/a-1/runs/r-9");
    expect(route.automationId).toBe("a-1");
    expect(route.automationRunId).toBe("r-9");
  });

  it("ignores a run segment that names no run", () => {
    expect(parseRoute("/automations/a-1/runs").automationRunId).toBeNull();
  });

  it("round-trips each URL through the path builder", () => {
    for (const path of [
      "/automations",
      "/automations/a-1",
      "/automations/a-1/runs/r-9",
    ]) {
      expect(routeToPath(parseRoute(path))).toBe(path);
    }
  });

  it("carries the focused host like any other route", () => {
    const route = parseRoute("/automations/a-1/runs/r-9?host=mini");
    expect(route.hostId).toBe("mini");
    expect(routeToPath(route)).toBe("/automations/a-1/runs/r-9?host=mini");
  });

  it("keeps ids out of telemetry", () => {
    expect(routePattern("/automations")).toBe("/automations");
    expect(routePattern("/automations/a-1")).toBe("/automations/:automationId");
    expect(routePattern("/automations/a-1/runs/r-9")).toBe(
      "/automations/:automationId/runs/:runId",
    );
  });

  it("survives an id that needed encoding", () => {
    const path = routeToPath({
      view: "automations",
      automationId: "a/1",
      automationRunId: "r 9",
    });
    expect(parseRoute(path).automationId).toBe("a/1");
    expect(parseRoute(path).automationRunId).toBe("r 9");
  });
});
