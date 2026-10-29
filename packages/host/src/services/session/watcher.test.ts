import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { appState } from "../../state";
import { WatcherHandle, startWatcher } from "./watcher";

// ---------------------------------------------------------------------------
// Mocks — must be defined before importing the module under test.
// ---------------------------------------------------------------------------

const mockSend = vi.fn();
vi.mock("@argus/host/bus", () => ({
  emitHostEvent: (...args: unknown[]) => mockSend(...args),
}));

const gitMock = vi.fn<(cwd: string, args: string[]) => Promise<string>>();
vi.mock("./git", () => ({
  git: (...args: unknown[]) => gitMock(args[0] as string, args[1] as string[]),
}));

vi.mock("../../state", () => ({
  appState: {
    sessions: new Map(),
    agents: new Map(),
  },
}));

vi.mock("node:fs", () => ({
  default: {
    watch: () => ({
      on: vi.fn(),
      close: vi.fn(),
    }),
  },
}));

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("watcherHandle", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mockSend.mockClear();
    gitMock.mockReset();
    appState.sessions.clear();
    appState.agents.clear();
    // Seed an active agent so the periodic-poll agent gate doesn't short-
    // circuit. Tests that specifically exercise the gate set this up
    // themselves.
    appState.agents.set("agent-1", {
      agentId: "agent-1",
      sessionId: "ws-1",
      status: "idle",
    } as never);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("uses git diff HEAD --numstat so staged changes are included in stats", async () => {
    gitMock.mockImplementation((_cwd, args) => {
      if (args[0] === "diff" && args[1] === "HEAD" && args[2] === "--numstat") {
        return Promise.resolve("1\t0\tstaged-only.ts\n");
      }
      if (args[0] === "ls-files") {
        return Promise.resolve("");
      }

      return Promise.resolve("");
    });

    const handle = new WatcherHandle("ws-1", "/repo");
    handle.start(5000);
    await vi.advanceTimersByTimeAsync(0);

    expect(gitMock).toHaveBeenCalledWith("/repo", [
      "diff",
      "HEAD",
      "--numstat",
    ]);
    expect(mockSend).toHaveBeenCalledWith("session:diff-changed:ws-1", {
      files: 1,
      additions: 1,
      deletions: 0,
    });

    handle.stop();
  });

  it("polls immediately on start and emits diff-changed", async () => {
    gitMock.mockImplementation((_cwd, args) => {
      if (args[0] === "diff") {
        return Promise.resolve("5\t2\tsrc/index.ts\n");
      }
      if (args[0] === "ls-files") {
        return Promise.resolve("newfile.txt\n");
      }

      return Promise.resolve("");
    });

    const handle = new WatcherHandle("ws-1", "/repo");
    handle.start(5000);

    // Flush the immediate poll (async)
    await vi.advanceTimersByTimeAsync(0);

    expect(mockSend).toHaveBeenCalledWith("session:diff-changed:ws-1", {
      files: 2, // 1 tracked + 1 untracked
      additions: 5,
      deletions: 2,
    });

    handle.stop();
  });

  it("does not emit duplicate events when fingerprint is unchanged", async () => {
    gitMock.mockImplementation((_cwd, args) => {
      if (args[0] === "diff") {
        return Promise.resolve("1\t0\tfile.ts\n");
      }
      if (args[0] === "ls-files") {
        return Promise.resolve("");
      }

      return Promise.resolve("");
    });

    const handle = new WatcherHandle("ws-1", "/repo");
    handle.start(100);

    await vi.advanceTimersByTimeAsync(0); // first poll
    expect(mockSend).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(100); // second poll, same data
    expect(mockSend).toHaveBeenCalledTimes(1); // no duplicate

    handle.stop();
  });

  it("emits again when fingerprint changes", async () => {
    let callCount = 0;
    gitMock.mockImplementation((_cwd, args) => {
      if (args[0] === "diff") {
        callCount++;

        return Promise.resolve(
          callCount === 1 ? "1\t0\tfile.ts\n" : "2\t1\tfile.ts\n",
        );
      }
      if (args[0] === "ls-files") {
        return Promise.resolve("");
      }

      return Promise.resolve("");
    });

    const handle = new WatcherHandle("ws-1", "/repo");
    handle.start(100);

    await vi.advanceTimersByTimeAsync(0);
    expect(mockSend).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(100);
    expect(mockSend).toHaveBeenCalledTimes(2);

    handle.stop();
  });

  it("skips polling when paused", async () => {
    gitMock.mockImplementation((_cwd, args) => {
      if (args[0] === "diff") {
        return Promise.resolve("1\t0\tfile.ts\n");
      }
      if (args[0] === "ls-files") {
        return Promise.resolve("");
      }

      return Promise.resolve("");
    });

    const handle = new WatcherHandle("ws-1", "/repo");
    handle.start(100);

    await vi.advanceTimersByTimeAsync(0); // initial poll
    expect(mockSend).toHaveBeenCalledTimes(1);

    handle.pause();

    // Change the data so we'd see a new event if not paused
    gitMock.mockImplementation((_cwd, args) => {
      if (args[0] === "diff") {
        return Promise.resolve("9\t9\tother.ts\n");
      }
      if (args[0] === "ls-files") {
        return Promise.resolve("");
      }

      return Promise.resolve("");
    });

    await vi.advanceTimersByTimeAsync(100);
    expect(mockSend).toHaveBeenCalledTimes(1); // still 1 — paused

    handle.stop();
  });

  it("polls immediately on resume", async () => {
    gitMock.mockImplementation((_cwd, args) => {
      if (args[0] === "diff") {
        return Promise.resolve("1\t0\tfile.ts\n");
      }
      if (args[0] === "ls-files") {
        return Promise.resolve("");
      }

      return Promise.resolve("");
    });

    const handle = new WatcherHandle("ws-1", "/repo");
    handle.start(5000);

    await vi.advanceTimersByTimeAsync(0);
    expect(mockSend).toHaveBeenCalledTimes(1);

    handle.pause();

    // Change data while paused
    gitMock.mockImplementation((_cwd, args) => {
      if (args[0] === "diff") {
        return Promise.resolve("3\t1\tupdated.ts\n");
      }
      if (args[0] === "ls-files") {
        return Promise.resolve("");
      }

      return Promise.resolve("");
    });

    handle.resume();
    await vi.advanceTimersByTimeAsync(0);
    expect(mockSend).toHaveBeenCalledTimes(2);

    handle.stop();
  });

  it("stop() clears the interval", async () => {
    gitMock.mockImplementation((_cwd, args) => {
      if (args[0] === "diff") {
        return Promise.resolve("1\t0\tfile.ts\n");
      }
      if (args[0] === "ls-files") {
        return Promise.resolve("");
      }

      return Promise.resolve("");
    });

    const handle = new WatcherHandle("ws-1", "/repo");
    handle.start(100);

    await vi.advanceTimersByTimeAsync(0);
    handle.stop();

    // Change data after stop
    gitMock.mockImplementation((_cwd, args) => {
      if (args[0] === "diff") {
        return Promise.resolve("99\t99\tfile.ts\n");
      }
      if (args[0] === "ls-files") {
        return Promise.resolve("");
      }

      return Promise.resolve("");
    });

    await vi.advanceTimersByTimeAsync(500);
    expect(mockSend).toHaveBeenCalledTimes(1); // no new events
  });

  it("handles git errors gracefully (non-fatal)", async () => {
    gitMock.mockRejectedValue(new Error("worktree deleted"));

    const handle = new WatcherHandle("ws-1", "/repo");
    handle.start(100);

    // Should not throw
    await vi.advanceTimersByTimeAsync(0);
    expect(mockSend).not.toHaveBeenCalled();

    handle.stop();
  });

  it("counts untracked files in stats", async () => {
    gitMock.mockImplementation((_cwd, args) => {
      if (args[0] === "diff") {
        return Promise.resolve("");
      } // no tracked changes
      if (args[0] === "ls-files") {
        return Promise.resolve("new1.txt\nnew2.txt\nnew3.txt\n");
      }

      return Promise.resolve("");
    });

    const handle = new WatcherHandle("ws-1", "/repo");
    handle.start(100);
    await vi.advanceTimersByTimeAsync(0);

    expect(mockSend).toHaveBeenCalledWith("session:diff-changed:ws-1", {
      files: 3,
      additions: 0,
      deletions: 0,
    });

    handle.stop();
  });

  it("sums committed diff (base...HEAD) and working-tree diff", async () => {
    appState.sessions.set("ws-1", {
      id: "ws-1",
      kind: "worktree",
      branch: "feature",
      base_branch: "main",
      description: "",
      path: "/repo",
      repo_root: "/repo",
      status: "ready",
    });

    gitMock.mockImplementation((_cwd, args) => {
      if (args[0] === "diff" && args[1] === "HEAD" && args[2] === "--numstat") {
        return Promise.resolve("2\t1\tworking.ts\n");
      }
      if (
        args[0] === "diff" &&
        args[1] === "main...HEAD" &&
        args[2] === "--numstat"
      ) {
        return Promise.resolve("10\t3\tcommitted.ts\n5\t0\tshared.ts\n");
      }
      if (args[0] === "ls-files") {
        return Promise.resolve("");
      }

      return Promise.resolve("");
    });

    const handle = new WatcherHandle("ws-1", "/repo");
    handle.start(5000);
    await vi.advanceTimersByTimeAsync(0);

    expect(mockSend).toHaveBeenCalledWith("session:diff-changed:ws-1", {
      files: 3,
      additions: 17,
      deletions: 4,
    });

    handle.stop();
  });

  it("dedupes files that appear in both committed and working-tree diffs", async () => {
    appState.sessions.set("ws-1", {
      id: "ws-1",
      kind: "worktree",
      branch: "feature",
      base_branch: "main",
      description: "",
      path: "/repo",
      repo_root: "/repo",
      status: "ready",
    });

    gitMock.mockImplementation((_cwd, args) => {
      if (args[0] === "diff" && args[1] === "HEAD") {
        return Promise.resolve("1\t1\tshared.ts\n");
      }
      if (args[0] === "diff" && args[1] === "main...HEAD") {
        return Promise.resolve("5\t2\tshared.ts\n");
      }
      if (args[0] === "ls-files") {
        return Promise.resolve("");
      }

      return Promise.resolve("");
    });

    const handle = new WatcherHandle("ws-1", "/repo");
    handle.start(5000);
    await vi.advanceTimersByTimeAsync(0);

    // Counts are summed; file count is deduped (1 unique path).
    expect(mockSend).toHaveBeenCalledWith("session:diff-changed:ws-1", {
      files: 1,
      additions: 6,
      deletions: 3,
    });

    handle.stop();
  });

  it("skips committed diff when session has no base branch", async () => {
    gitMock.mockImplementation((_cwd, args) => {
      if (args[0] === "diff" && args[1] === "HEAD") {
        return Promise.resolve("1\t0\tfile.ts\n");
      }
      if (args[0] === "ls-files") {
        return Promise.resolve("");
      }

      return Promise.resolve("");
    });

    const handle = new WatcherHandle("ws-1", "/repo");
    handle.start(5000);
    await vi.advanceTimersByTimeAsync(0);

    // Only the two base commands should be called — no base...HEAD diff.
    const diffCalls = gitMock.mock.calls.filter((c) => c[1][0] === "diff");
    expect(diffCalls).toHaveLength(1);
    expect(diffCalls[0][1]).toEqual(["diff", "HEAD", "--numstat"]);

    handle.stop();
  });

  it("survives when base...HEAD fails (e.g. new branch with no commits)", async () => {
    appState.sessions.set("ws-1", {
      id: "ws-1",
      kind: "worktree",
      branch: "feature",
      base_branch: "main",
      description: "",
      path: "/repo",
      repo_root: "/repo",
      status: "ready",
    });

    gitMock.mockImplementation((_cwd, args) => {
      if (args[0] === "diff" && args[1] === "HEAD") {
        return Promise.resolve("1\t0\tfile.ts\n");
      }
      if (args[0] === "diff" && args[1] === "main...HEAD") {
        return Promise.reject(new Error("unknown revision"));
      }
      if (args[0] === "ls-files") {
        return Promise.resolve("");
      }

      return Promise.resolve("");
    });

    const handle = new WatcherHandle("ws-1", "/repo");
    handle.start(5000);
    await vi.advanceTimersByTimeAsync(0);

    expect(mockSend).toHaveBeenCalledWith("session:diff-changed:ws-1", {
      files: 1,
      additions: 1,
      deletions: 0,
    });

    handle.stop();
  });

  it("handles binary files in numstat (dash for additions/deletions)", async () => {
    gitMock.mockImplementation((_cwd, args) => {
      if (args[0] === "diff") {
        return Promise.resolve("-\t-\timage.png\n");
      }
      if (args[0] === "ls-files") {
        return Promise.resolve("");
      }

      return Promise.resolve("");
    });

    const handle = new WatcherHandle("ws-1", "/repo");
    handle.start(100);
    await vi.advanceTimersByTimeAsync(0);

    expect(mockSend).toHaveBeenCalledWith("session:diff-changed:ws-1", {
      files: 1,
      additions: 0,
      deletions: 0,
    });

    handle.stop();
  });
});

describe("startWatcher", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mockSend.mockClear();
    gitMock.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns a handle that is already polling", async () => {
    gitMock.mockImplementation((_cwd, args) => {
      if (args[0] === "diff") {
        return Promise.resolve("1\t0\tfile.ts\n");
      }
      if (args[0] === "ls-files") {
        return Promise.resolve("");
      }

      return Promise.resolve("");
    });

    const handle = startWatcher("ws-1", "/repo");
    await vi.advanceTimersByTimeAsync(0);

    expect(mockSend).toHaveBeenCalledTimes(1);
    handle.stop();
  });
});
