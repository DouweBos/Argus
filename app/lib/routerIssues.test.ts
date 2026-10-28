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

  it("keeps identifiers out of telemetry patterns", () => {
    expect(routePattern("/issues/created/ENG-1")).toBe(
      "/issues/created/:issue",
    );
    expect(routePattern("/issues")).toBe("/issues");
  });
});
