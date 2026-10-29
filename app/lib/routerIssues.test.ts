import { describe, expect, it } from "vitest";
import { parseRoute, routePattern, routeToPath } from "./router";

describe("issues routes", () => {
  it("parses scope and the open issue", () => {
    expect(parseRoute("/issues")).toMatchObject({
      view: "issues",
      issueScope: "assigned",
      issueRef: null,
    });
    expect(parseRoute("/issues/STR-12")).toMatchObject({
      issueScope: "assigned",
      issueRef: "STR-12",
    });
    expect(parseRoute("/issues/created/STR-12")).toMatchObject({
      issueScope: "created",
      issueRef: "STR-12",
    });
    expect(parseRoute("/pull-requests")).toMatchObject({ issueRef: null });
  });

  it("round-trips through paths", () => {
    for (const path of [
      "/issues",
      "/issues/subscribed",
      "/issues/created/ENG-1",
      "/issues/ENG-1",
    ]) {
      expect(routeToPath(parseRoute(path))).toBe(path);
    }
  });

  it("carries a search term only on /issues/search", () => {
    expect(parseRoute("/issues/search?q=ugc%20card")).toMatchObject({
      issueScope: "search",
      issueQuery: "ugc card",
      issueRef: null,
    });
    expect(parseRoute("/issues/search/RTN-9181?q=ugc")).toMatchObject({
      issueRef: "RTN-9181",
      issueQuery: "ugc",
    });
    expect(parseRoute("/issues?q=ugc")).toMatchObject({ issueQuery: null });
    for (const path of [
      "/issues/search?q=ugc%20card",
      "/issues/search/RTN-9181?q=ugc",
    ]) {
      expect(routeToPath(parseRoute(path))).toBe(path);
    }
    expect(routePattern("/issues/search/RTN-9181?q=ugc")).toBe(
      "/issues/search/:issue",
    );
  });

  it("keeps identifiers out of telemetry patterns", () => {
    expect(routePattern("/issues/created/ENG-1")).toBe(
      "/issues/created/:issue",
    );
    expect(routePattern("/issues")).toBe("/issues");
  });
});
