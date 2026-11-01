import { describe, expect, it } from "vitest";
import {
  HOME,
  paneFor,
  pathForScreen,
  projectKey,
  type Screen,
  screenFromPath,
  screenPattern,
} from "./screens";

describe("screenFromPath", () => {
  it.each<[string, Screen]>([
    ["/", HOME],
    ["/projects/abc", { name: "project", projectKey: "abc" }],
    ["/settings", { name: "settings" }],
    ["/devices", { name: "devices" }],
    [
      "/devices/ios/ABC-123",
      { name: "device", platform: "ios", deviceKey: "ABC-123" },
    ],
    [
      "/devices/android/avd%3APixel_9",
      { name: "device", platform: "android", deviceKey: "avd:Pixel_9" },
    ],
    ["/sessions/s1/agents", { name: "session", sessionId: "s1" }],
    // The session home is gone; old links land on its agents.
    ["/sessions/s1", { name: "session", sessionId: "s1" }],
    [
      "/sessions/s1/agents/a1",
      { name: "agent", sessionId: "s1", agentId: "a1" },
    ],
    [
      "/sessions/s1/git/working",
      { name: "changes", sessionId: "s1", mode: "working" },
    ],
    [
      "/sessions/s1/git/branch",
      { name: "changes", sessionId: "s1", mode: "branch" },
    ],
    ["/sessions/s1/agents/a1?host=h1", { name: "agent", sessionId: "s1", agentId: "a1" }],
  ])("reads %s", (path, screen) => {
    expect(screenFromPath(path)).toEqual(screen);
  });

  it.each([
    "/inbox",
    "/automations/a1",
    "/pull-requests/o/r/1",
    "/usage/cost",
    "/devices/web/tab-1",
  ])("opens the nearest screen it has for %s", (path) => {
    const screen = screenFromPath(path);

    expect(["projects", "devices"]).toContain(screen.name);
  });

  it("opens a git sub-view it doesn't have on the branch diff", () => {
    expect(screenFromPath("/sessions/s1/git/stashes")).toEqual({
      name: "changes",
      sessionId: "s1",
      mode: "branch",
    });
  });
});

describe("pathForScreen", () => {
  it.each([
    "/",
    "/projects/0123456789abcdef",
    "/settings",
    "/devices",
    "/devices/ios/ABC-123",
    "/sessions/s1/agents",
    "/sessions/s1/agents/a1",
    "/sessions/s1/git/working",
    "/sessions/s1/git/branch",
  ])("round-trips %s", (path) => {
    expect(pathForScreen(screenFromPath(path))).toBe(path);
  });
});

describe("projectKey", () => {
  it("is stable, opaque and distinct per repo", () => {
    const key = projectKey("/Users/me/Work/app");

    expect(key).toBe(projectKey("/Users/me/Work/app"));
    expect(key).toMatch(/^[0-9a-f]{16}$/);
    expect(key).not.toContain("me");
    expect(projectKey("/Users/me/Work/api")).not.toBe(key);
  });
});

describe("screenPattern", () => {
  it("never carries an id, and matches the phone's", () => {
    expect(
      screenPattern({ name: "agent", sessionId: "s1", agentId: "a1" }),
    ).toBe("/sessions/:sessionId/agents");
    expect(screenPattern({ name: "project", projectKey: "k" })).toBe(
      "/projects/:projectKey",
    );
    expect(
      screenPattern({ name: "changes", sessionId: "s1", mode: "working" }),
    ).toBe("/sessions/:sessionId/git/working");
    expect(
      screenPattern({ name: "device", platform: "ios", deviceKey: "d" }),
    ).toBe("/devices/:platform/:deviceKey");
  });
});

describe("paneFor", () => {
  it("keeps the project list and a project in the master pane", () => {
    expect(paneFor(HOME)).toBe("master");
    expect(paneFor({ name: "project", projectKey: "k" })).toBe("master");
  });

  it("puts everything opened out of a project in the detail pane", () => {
    expect(paneFor({ name: "agent", sessionId: "s", agentId: "a" })).toBe(
      "detail",
    );
    expect(paneFor({ name: "devices" })).toBe("detail");
    expect(paneFor({ name: "settings" })).toBe("detail");
  });
});
