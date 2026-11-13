import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { appState } from "../../state";
import { toViewedState } from "../github/viewedFiles";

vi.mock("../telemetry/telemetry", () => ({ capture: vi.fn() }));

const { getSessionViewedFiles, resetViewedFilesCache, setSessionFileViewed } =
  await import("./viewedFiles");

let home: string;
let worktree: string;

describe("session viewed files", () => {
  beforeEach(() => {
    home = fs.mkdtempSync(path.join(os.tmpdir(), "viewed-home-"));
    worktree = fs.mkdtempSync(path.join(os.tmpdir(), "viewed-wt-"));
    vi.stubEnv("ARGUS_HOME", home);
    resetViewedFilesCache();
    appState.sessions.set("s1", {
      id: "s1",
      kind: "worktree",
      branch: "feat/x",
      description: "",
      path: worktree,
      repo_root: worktree,
      status: "ready",
    });
    fs.writeFileSync(path.join(worktree, "a.ts"), "one");
  });

  afterEach(() => {
    appState.sessions.delete("s1");
    vi.unstubAllEnvs();
    fs.rmSync(home, { recursive: true, force: true });
    fs.rmSync(worktree, { recursive: true, force: true });
  });

  it("reads a mark back as viewed until the file changes", async () => {
    await setSessionFileViewed({
      sessionId: "s1",
      mode: "branch",
      path: "a.ts",
      viewed: true,
    });
    await expect(getSessionViewedFiles("s1", "branch")).resolves.toEqual([
      { path: "a.ts", state: "viewed" },
    ]);
    await expect(getSessionViewedFiles("s1", "working")).resolves.toEqual([]);

    fs.writeFileSync(path.join(worktree, "a.ts"), "two");
    await expect(getSessionViewedFiles("s1", "branch")).resolves.toEqual([
      { path: "a.ts", state: "changed" },
    ]);
  });

  it("survives a restart and forgets an untick", async () => {
    await setSessionFileViewed({
      sessionId: "s1",
      mode: "working",
      path: "a.ts",
      viewed: true,
    });
    resetViewedFilesCache();
    await expect(getSessionViewedFiles("s1", "working")).resolves.toHaveLength(
      1,
    );

    await setSessionFileViewed({
      sessionId: "s1",
      mode: "working",
      path: "a.ts",
      viewed: false,
    });
    await expect(getSessionViewedFiles("s1", "working")).resolves.toEqual([]);
  });

  it("refuses a path outside the worktree", async () => {
    await expect(
      setSessionFileViewed({
        sessionId: "s1",
        mode: "branch",
        path: "../x",
        viewed: true,
      }),
    ).rejects.toMatch(/outside/);
  });
});

describe("toViewedState", () => {
  it("maps GitHub's states", () => {
    expect(toViewedState("VIEWED")).toBe("viewed");
    expect(toViewedState("DISMISSED")).toBe("changed");
    expect(toViewedState("UNVIEWED")).toBeNull();
  });
});
