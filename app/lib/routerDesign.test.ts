import { describe, expect, it } from "vitest";
import { parseRoute, routePattern, routeToPath } from "./router";

const URL = "https://www.figma.com/design/AbC/App?node-id=12-34&t=x";

describe("design viewer route", () => {
  it("parses the frame and the session", () => {
    const path = `/design?url=${encodeURIComponent(URL)}&session=s1`;
    expect(parseRoute(path)).toMatchObject({
      view: "design",
      designUrl: URL,
      designSessionId: "s1",
    });
    expect(parseRoute(`${path}&tab=pages&compare=1`)).toMatchObject({
      designTab: "pages",
      designCompare: true,
    });
    expect(parseRoute("/design?compare=1")).toMatchObject({
      designCompare: false,
      designTab: "layers",
    });
    expect(parseRoute("/issues")).toMatchObject({
      designUrl: null,
      designSessionId: null,
    });
  });

  it("round-trips through paths, host included", () => {
    const path = routeToPath({
      view: "design",
      designUrl: URL,
      designSessionId: "s1",
      designTab: "comments",
      designCompare: true,
      hostId: "mini",
    });
    expect(parseRoute(path)).toMatchObject({
      view: "design",
      designUrl: URL,
      designSessionId: "s1",
      designTab: "comments",
      designCompare: true,
      hostId: "mini",
    });
    expect(routeToPath(parseRoute(path))).toBe(path);
  });

  it("keeps the frame link out of telemetry patterns", () => {
    expect(routePattern(`/design?url=${encodeURIComponent(URL)}`)).toBe(
      "/design",
    );
  });
});
