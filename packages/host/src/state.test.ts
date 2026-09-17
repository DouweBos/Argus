import { describe, expect, it } from "vitest";
import { appState } from "./state";

describe("appState", () => {
  it("has empty collections by default", () => {
    expect(appState.repoRoots.size).toBe(0);
    expect(appState.sessions.size).toBe(0);
    expect(appState.terminals.size).toBe(0);
    expect(appState.agents.size).toBe(0);
    expect(appState.simulators.size).toBe(0);
    expect(appState.watchers.size).toBe(0);
  });

  it("supports CRUD on repoRoots", () => {
    appState.repoRoots.add("/test/repo");
    expect(appState.repoRoots.has("/test/repo")).toBe(true);
    appState.repoRoots.delete("/test/repo");
    expect(appState.repoRoots.has("/test/repo")).toBe(false);
  });

  it("supports Map operations on sessions", () => {
    const ws = {
      id: "ws-1",
      kind: "worktree" as const,
      branch: "main",
      description: "test",
      path: "/tmp/ws",
      repo_root: "/tmp/repo",
      status: "ready" as const,
    };
    appState.sessions.set("ws-1", ws);
    expect(appState.sessions.get("ws-1")).toBe(ws);
    appState.sessions.delete("ws-1");
    expect(appState.sessions.has("ws-1")).toBe(false);
  });

  it("supports Map operations on simulators", () => {
    appState.simulators.set("test-udid", {
      udid: "test-udid",
      deviceName: "iPhone 16",
      captureActive: true,
      mjpegPort: 8080,
    });
    expect(appState.simulators.get("test-udid")?.udid).toBe("test-udid");
    appState.simulators.delete("test-udid");
    expect(appState.simulators.has("test-udid")).toBe(false);
  });
});
