import { describe, expect, it } from "vitest";
import { appState } from "./state";

describe("AppState", () => {
  it("has empty collections by default", () => {
    expect(appState.repoRoots.size).toBe(0);
    expect(appState.workspaces.size).toBe(0);
    expect(appState.terminals.size).toBe(0);
    expect(appState.agents.size).toBe(0);
    expect(appState.simulator).toBeNull();
    expect(appState.watchers.size).toBe(0);
  });

  it("supports CRUD on repoRoots", () => {
    appState.repoRoots.add("/test/repo");
    expect(appState.repoRoots.has("/test/repo")).toBe(true);
    appState.repoRoots.delete("/test/repo");
    expect(appState.repoRoots.has("/test/repo")).toBe(false);
  });

  it("supports Map operations on workspaces", () => {
    const ws = {
      id: "ws-1",
      kind: "worktree" as const,
      branch: "main",
      description: "test",
      path: "/tmp/ws",
      repo_root: "/tmp/repo",
      status: "ready" as const,
    };
    appState.workspaces.set("ws-1", ws);
    expect(appState.workspaces.get("ws-1")).toBe(ws);
    appState.workspaces.delete("ws-1");
    expect(appState.workspaces.has("ws-1")).toBe(false);
  });

  it("can set and clear simulator session", () => {
    appState.simulator = {
      udid: "test-udid",
      deviceName: "iPhone 16",
      captureActive: true,
      mjpegPort: 8080,
    };
    expect(appState.simulator?.udid).toBe("test-udid");
    appState.simulator = null;
    expect(appState.simulator).toBeNull();
  });
});
