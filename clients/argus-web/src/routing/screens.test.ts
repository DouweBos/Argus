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
    ["/sessions/s1", { name: "sessionHome", sessionId: "s1" }],
    ["/sessions/s1/home", { name: "sessionHome", sessionId: "s1" }],
    [
      "/sessions/s1/chats/h1",
      { name: "chat", sessionId: "s1", historyId: "h1" },
    ],
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
    ["/inbox", { name: "inbox" }],
    ["/inbox/proposals/p1", { name: "proposal", proposalId: "p1" }],
    ["/automations", { name: "automations" }],
    ["/automations/a1", { name: "automation", automationId: "a1" }],
    [
      "/automations/a1/runs/r1",
      { name: "automationRun", automationId: "a1", runId: "r1" },
    ],
    ["/automations/quick", { name: "quickRun" }],
    ["/automations/quick/runs/r1", { name: "quickRunDetail", runId: "r1" }],
    ["/automations/describe", { name: "describe" }],
  ])("reads %s", (path, screen) => {
    expect(screenFromPath(path)).toEqual(screen);
  });

  it.each([
    "/devices/web/tab-1",
  ])("opens the nearest screen it has for %s", (path) => {
    const screen = screenFromPath(path);

    expect(["projects", "devices"]).toContain(screen.name);
  });

  it("opens a git sub-view it doesn't have on the branch diff", () => {
    expect(screenFromPath("/sessions/s1/git/reflog")).toEqual({
      name: "changes",
      sessionId: "s1",
      mode: "branch",
    });
  });
});

describe("usage, notifications and settings pages", () => {
  it.each<[string, Screen]>([
    ["/usage", { name: "usage", tab: "limits", range: "30d" }],
    ["/usage/cost?range=7d", { name: "usage", tab: "cost", range: "7d" }],
    ["/usage/tokens", { name: "usage", tab: "tokens", range: "30d" }],
    ["/notifications", { name: "notifications" }],
    ["/settings/appearance", { name: "settingsPage", page: "appearance" }],
    [
      "/settings/claude-accounts",
      { name: "settingsPage", page: "claude-accounts" },
    ],
    ["/settings/nope", { name: "settings" }],
  ])("reads %s", (path, screen) => {
    expect(screenFromPath(path)).toEqual(screen);
  });

  it.each([
    "/usage",
    "/usage/cost?range=7d",
    "/usage/tokens",
    "/notifications",
    "/settings/device-hosts",
  ])("round-trips %s", (path) => {
    expect(pathForScreen(screenFromPath(path))).toBe(path);
  });

  it("names the pattern, never the range", () => {
    expect(
      screenPattern({ name: "usage", tab: "cost", range: "7d" }),
    ).toBe("/usage/cost");
    expect(paneFor({ name: "notifications" })).toBe("detail");
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
    "/sessions/s1",
    "/sessions/s1/chats/h1",
    "/sessions/s1/git/working",
    "/sessions/s1/git/branch",
    "/sessions/s1/code/quick-open",
    "/sessions/s1/code/search",
    "/sessions/s1/code?path=src%2Fapp.ts&line=12",
    "/sessions/s1/terminals",
    "/sessions/s1/terminals/t1",
    "/sessions/s1/browser",
    "/sessions/s1/git/working/diff?path=src%2Fapp.ts",
    "/inbox",
    "/inbox/proposals/p1",
    "/automations",
    "/automations/a1",
    "/automations/a1/runs/r1",
    "/automations/quick",
    "/automations/quick/runs/r1",
    "/automations/describe",
  ])("round-trips %s", (path) => {
    expect(pathForScreen(screenFromPath(path))).toBe(path);
  });
});

describe("session tool screens", () => {
  it.each<[string, Screen]>([
    // The Mac's and the phone's `/code?path=&line=`.
    [
      "/sessions/s1/code?path=src/a.ts&line=4",
      { name: "file", sessionId: "s1", path: "src/a.ts", line: 4 },
    ],
    [
      "/sessions/s1/code?path=src/a.ts&line=x",
      { name: "file", sessionId: "s1", path: "src/a.ts", line: null },
    ],
    ["/sessions/s1/code", { name: "files", sessionId: "s1" }],
    ["/sessions/s1/browser", { name: "browser", sessionId: "s1" }],
    ["/sessions/s1/code/search?host=h", { name: "search", sessionId: "s1" }],
    [
      "/sessions/s1/terminals/t%3A1",
      { name: "terminals", sessionId: "s1", terminalId: "t:1" },
    ],
    [
      "/sessions/s1/git/branch/diff?path=a.ts",
      { name: "fileDiff", sessionId: "s1", mode: "branch", path: "a.ts" },
    ],
    // A diff with no file is the whole diff.
    [
      "/sessions/s1/git/working/diff",
      { name: "changes", sessionId: "s1", mode: "working" },
    ],
  ])("reads %s", (path, screen) => {
    expect(screenFromPath(path)).toEqual(screen);
  });

  it("names patterns, never paths or ids", () => {
    expect(
      screenPattern({ name: "file", sessionId: "s", path: "a.ts", line: 1 }),
    ).toBe("/sessions/:sessionId/code");
    expect(
      screenPattern({ name: "terminals", sessionId: "s", terminalId: "t" }),
    ).toBe("/terminals/:terminalId");
    expect(
      screenPattern({
        name: "fileDiff",
        sessionId: "s",
        mode: "working",
        path: "a.ts",
      }),
    ).toBe("/sessions/:sessionId/git/working/diff");
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
    expect(
      screenPattern({ name: "automationRun", automationId: "a", runId: "r" }),
    ).toBe("/automations/:automationId/runs/:runId");
    expect(screenPattern({ name: "proposal", proposalId: "p" })).toBe(
      "/inbox/proposals/:proposalId",
    );
  });
});

describe("paneFor", () => {
  it("keeps the project list and a project in the master pane", () => {
    expect(paneFor(HOME)).toBe("master");
    expect(paneFor({ name: "project", projectKey: "k" })).toBe("master");
    expect(paneFor({ name: "proposal", proposalId: "p" })).toBe("detail");
    expect(paneFor({ name: "quickRun" })).toBe("detail");
  });

  it("puts everything opened out of a project in the detail pane", () => {
    expect(paneFor({ name: "agent", sessionId: "s", agentId: "a" })).toBe(
      "detail",
    );
    expect(paneFor({ name: "devices" })).toBe("detail");
    expect(paneFor({ name: "settings" })).toBe("detail");
    expect(paneFor({ name: "inbox" })).toBe("detail");
    expect(paneFor({ name: "automations" })).toBe("detail");
  });
});

describe("design screen", () => {
  const url = "https://www.figma.com/design/AbC/App?node-id=1-2";
  const encoded = encodeURIComponent(url);

  it("reads a frame opened from a session", () => {
    expect(
      screenFromPath(`/design?url=${encoded}&session=s1&tab=pages&compare=1`),
    ).toEqual({
      name: "design",
      url,
      sessionId: "s1",
      tab: "pages",
      compare: true,
    });
  });

  it("opens Home with no frame named", () => {
    expect(screenFromPath("/design")).toEqual(HOME);
  });

  it("round-trips and stays out of telemetry", () => {
    const path = `/design?url=${encoded}&session=s1&compare=1&tab=comments`;
    const screen = screenFromPath(path);

    expect(screenFromPath(pathForScreen(screen))).toEqual(screen);
    expect(screenPattern(screen)).toBe("/design");
    expect(paneFor(screen)).toBe("detail");
  });
});

describe("issues screen", () => {
  it("reads scopes, an open issue and a search", () => {
    expect(screenFromPath("/issues")).toEqual({
      name: "issues",
      scope: "assigned",
      query: null,
      issueRef: null,
    });
    expect(screenFromPath("/issues/created/ENG-12")).toMatchObject({
      scope: "created",
      issueRef: "ENG-12",
    });
    expect(screenFromPath("/issues/search?q=login")).toMatchObject({
      scope: "search",
      query: "login",
    });
  });

  it("round-trips and names patterns, never the issue", () => {
    for (const path of [
      "/issues",
      "/issues/subscribed/ENG-3",
      "/issues/search/ENG-4?q=sign%20in",
    ]) {
      const screen = screenFromPath(path);
      expect(pathForScreen(screen)).toBe(path);
      expect(screenPattern(screen)).not.toContain("ENG");
    }
    expect(paneFor(screenFromPath("/issues"))).toBe("detail");
  });
});

describe("shipping screens", () => {
  it.each([
    ["/sessions/s1/git/branches", { name: "branches", sessionId: "s1" }],
    [
      "/sessions/s1/git/branches/feature%2Fx",
      { name: "branch", sessionId: "s1", ref: "feature/x" },
    ],
    [
      "/sessions/s1/git/compare?left=main&right=origin%2Fx",
      { name: "compare", sessionId: "s1", left: "main", right: "origin/x" },
    ],
    ["/sessions/s1/git/stashes", { name: "stashes", sessionId: "s1" }],
    [
      "/sessions/s1/git/history?commit=abc1234",
      { name: "commit", sessionId: "s1", hash: "abc1234" },
    ],
    ["/pull-requests", { name: "pullRequests" }],
    [
      "/pull-requests/o/r/12",
      { name: "pullRequest", owner: "o", repo: "r", number: 12 },
    ],
  ])("round-trips %s", (path, screen) => {
    expect(screenFromPath(path)).toEqual(screen);
    expect(pathForScreen(screen as Screen)).toBe(path);
  });

  it("falls back for a compare missing a side and a bad hash", () => {
    expect(screenFromPath("/sessions/s1/git/compare?left=main").name).toBe(
      "branches",
    );
    expect(screenFromPath("/sessions/s1/git/history?commit=nope!").name).toBe(
      "changes",
    );
  });

  it("names patterns, never branches, hashes or repos", () => {
    expect(
      screenPattern({ name: "branch", sessionId: "s1", ref: "secret" }),
    ).toBe("/sessions/:sessionId/git/branches/:branchName");
    expect(
      screenPattern({ name: "pullRequest", owner: "o", repo: "r", number: 1 }),
    ).toBe("/pull-requests/:owner/:repo/:number");
  });
});
