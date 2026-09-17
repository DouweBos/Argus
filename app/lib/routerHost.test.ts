/**
 * Which host a screen reads from is part of the route: several are attached at
 * once, and back/forward should move between them like any other navigation.
 */

import { describe, expect, it } from "vitest";
import { parseRoute, routeToPath } from "./router";
import { LOCAL_HOST_ID } from "./transport/hostId";

describe("route host", () => {
  it("defaults to this Mac when the URL names no host", () => {
    expect(parseRoute("/sessions/s1/git").hostId).toBe(LOCAL_HOST_ID);
  });

  it("reads the host out of the query string", () => {
    const route = parseRoute("/sessions/s1/git/branches/main?host=mini");
    expect(route.hostId).toBe("mini");
    expect(route.gitView).toBe("branches");
    expect(route.gitRefName).toBe("main");
  });

  it("round-trips a host through the path builder", () => {
    expect(routeToPath({ view: "devices", hostId: "mini" })).toBe(
      "/devices?host=mini",
    );
    expect(parseRoute("/devices?host=mini").hostId).toBe("mini");
  });

  it("leaves this Mac's URLs clean", () => {
    expect(routeToPath({ view: "devices", hostId: LOCAL_HOST_ID })).toBe(
      "/devices",
    );
  });

  it("keeps the host alongside a git sub-view's own query params", () => {
    const route = parseRoute(
      "/sessions/s1/git/compare?left=a&right=b&host=mini",
    );
    expect(route.hostId).toBe("mini");
    expect(route.gitView).toBe("compare");
  });

  it("two hosts showing the same session path are two routes", () => {
    expect(routeToPath({ view: "session", sessionId: "s1" })).not.toBe(
      routeToPath({ view: "session", sessionId: "s1", hostId: "mini" }),
    );
  });
});
