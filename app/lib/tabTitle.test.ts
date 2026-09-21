import { describe, expect, it } from "vitest";
import { parseRoute } from "./router";
import { tabTitleForRoute } from "./tabTitle";

describe("tabTitleForRoute", () => {
  it("names the screen for non-session routes", () => {
    expect(tabTitleForRoute(parseRoute("/devices?host=mini"))).toBe("Devices");
    expect(tabTitleForRoute(parseRoute("/"))).toBe("Home");
  });

  it("prefers the session's own label", () => {
    const route = parseRoute("/sessions/s1/git");
    expect(tabTitleForRoute(route, "fix-login")).toBe("fix-login");
    expect(tabTitleForRoute(route, null)).toBe("Session");
  });

  it("names a pull request by repo and number", () => {
    expect(tabTitleForRoute(parseRoute("/pull-requests/acme/argus/42"))).toBe(
      "argus#42",
    );
  });
});
