import { describe, expect, it } from "vitest";
import {
  LOCAL_HOST_ID,
  parseRoute,
  routePattern,
  routeToPath,
  withHostParam,
} from "./route";

// Paths shared with ArgusCore's ArgusRouteTests, where both codecs agree.
describe("parseRoute", () => {
  it.each([
    ["/", "home"],
    ["/agents", "agents"],
    ["/runtimes", "runtimes"],
    ["/devices", "devices"],
    ["/inbox", "inbox"],
    ["/notifications", "notifications"],
    ["/pull-requests", "pull-requests"],
    ["/automations", "automations"],
    ["/nowhere", "home"],
  ])("reads %s as %s", (path, view) => {
    expect(parseRoute(path).view).toBe(view);
  });

  it("reads a session's agents, optionally focused on one", () => {
    expect(parseRoute("/sessions/s1/agents")).toMatchObject({
      view: "session",
      sessionId: "s1",
      panel: "agents",
      agentId: null,
    });
    expect(parseRoute("/sessions/s1/agents/a1")).toMatchObject({
      sessionId: "s1",
      panel: "agents",
      agentId: "a1",
    });
  });

  it("only reads an agent off the agents panel", () => {
    expect(parseRoute("/sessions/s1/git/working").agentId).toBeNull();
  });

  it("reads git sub-views and ref names", () => {
    expect(parseRoute("/sessions/s1/git/branch")).toMatchObject({
      panel: "git",
      gitView: "branch",
    });
    expect(parseRoute("/sessions/s1/git/branches/feature%2Ffoo")).toMatchObject(
      { gitView: "branches", gitRefName: "feature/foo" },
    );
  });

  it("reads devices, proposals, PRs and automation runs", () => {
    expect(parseRoute("/inbox/proposals/p1").proposalId).toBe("p1");
    expect(parseRoute("/pull-requests/houwert/argus/42").pr).toEqual({
      owner: "houwert",
      repo: "argus",
      number: 42,
    });
    expect(parseRoute("/automations/a1/runs/r1")).toMatchObject({
      automationId: "a1",
      automationRunId: "r1",
    });
    expect(parseRoute("/automations/quick/runs/r1")).toMatchObject({
      automationQuick: true,
      automationRunId: "r1",
    });
  });

  it("reads the host from the query, defaulting to this machine", () => {
    expect(parseRoute("/agents").hostId).toBe(LOCAL_HOST_ID);
    expect(parseRoute("/agents?host=h1").hostId).toBe("h1");
    expect(parseRoute("/agents?host=").hostId).toBe(LOCAL_HOST_ID);
  });
});

describe("routeToPath", () => {
  it.each([
    "/",
    "/agents",
    "/devices",
    "/inbox/proposals/p1",
    "/sessions/s1/agents",
    "/sessions/s1/agents/a1",
    "/sessions/s1/git/working",
    "/sessions/s1/git/branches/feature%2Ffoo",
    "/automations/a1/runs/r1",
    "/usage/cost?range=7d",
    "/agents?host=h1",
    "/sessions/s1/agents/a1?host=h1",
  ])("round-trips %s", (path) => {
    expect(routeToPath(parseRoute(path))).toBe(path);
  });

  it("encodes an agent id as one segment", () => {
    expect(
      routeToPath({
        view: "session",
        sessionId: "s1",
        panel: "agents",
        agentId: "a/1",
      }),
    ).toBe("/sessions/s1/agents/a%2F1");
  });

  it("keeps this machine off the URL", () => {
    expect(withHostParam("/agents", LOCAL_HOST_ID)).toBe("/agents");
    expect(withHostParam("/usage/cost?range=7d", "h 1")).toBe(
      "/usage/cost?range=7d&host=h%201",
    );
  });
});

describe("routePattern", () => {
  it("never carries an id", () => {
    expect(routePattern("/sessions/s1/agents/a1")).toBe(
      "/sessions/:sessionId/agents",
    );
    expect(routePattern("/inbox/proposals/p1")).toBe(
      "/inbox/proposals/:proposalId",
    );
    expect(routePattern("/pull-requests/o/r/1")).toBe(
      "/pull-requests/:owner/:repo/:number",
    );
    expect(routePattern("/agents?host=h1")).toBe("/agents");
  });
});
