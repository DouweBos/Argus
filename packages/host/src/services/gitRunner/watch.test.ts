/**
 * The remote git runner's worktree watch: held per connection, released on
 * disconnect, debounced into `git_status_changed`.
 */

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@argus/host/bus", () => ({ emitHostEvent: vi.fn() }));

const { emitHostEvent } = vi.mocked(await import("@argus/host/bus"));
const {
  DEBOUNCE_MS,
  MAX_WAIT_MS,
  beginRunnerRun,
  holdRepoWatch,
  isRelevantChange,
  setWatchRootForTest,
  watchedSessions,
} = await import("./watch");
const { closeConnection, runInConnection } =
  await import("../remote/connectionScope");

const linked = {
  worktree: "/w/feature",
  gitDir: "/r/.git/worktrees/feature",
  commonGitDir: "/r/.git",
};

/** The fake fs layer: which roots are open, and a way to fire a change. */
const roots = new Map<string, (file: string) => void>();

function hold(connectionId: string, sessionId = "s1", repo = linked): void {
  runInConnection(connectionId, () => holdRepoWatch(sessionId, repo));
}

function change(file: string): void {
  for (const [root, fire] of roots) {
    if (file === root || file.startsWith(`${root}/`)) {
      fire(file);
    }
  }
}

describe("isRelevantChange", () => {
  it("takes worktree files but not a main worktree's .git", () => {
    expect(isRelevantChange(linked, "/w/feature/src/a.ts")).toBe(true);
    const main = { worktree: "/r", gitDir: "/r/.git", commonGitDir: "/r/.git" };
    expect(isRelevantChange(main, "/r/a.ts")).toBe(true);
    expect(isRelevantChange(main, "/r/.git/objects/ab/cd")).toBe(false);
    expect(isRelevantChange(main, "/r/.git/refs/heads/main")).toBe(true);
    expect(isRelevantChange(main, "/r/.git/worktrees/other/HEAD")).toBe(false);
  });

  it("takes its own git dir state and the shared refs, not siblings'", () => {
    expect(isRelevantChange(linked, "/r/.git/worktrees/feature/HEAD")).toBe(
      true,
    );
    expect(isRelevantChange(linked, "/r/.git/worktrees/feature/index")).toBe(
      true,
    );
    expect(
      isRelevantChange(linked, "/r/.git/worktrees/feature/argus-scratch/x"),
    ).toBe(false);
    expect(isRelevantChange(linked, "/r/.git/refs/heads/feature")).toBe(true);
    expect(isRelevantChange(linked, "/r/.git/packed-refs")).toBe(true);
    expect(isRelevantChange(linked, "/r/.git/worktrees/other/index")).toBe(
      false,
    );
    expect(isRelevantChange(linked, "/r/.git/HEAD")).toBe(false);
    expect(isRelevantChange(linked, "/r/.git/objects/ab/cd")).toBe(false);
    expect(isRelevantChange(linked, "/w/other/a.ts")).toBe(false);
  });
});

describe("holdRepoWatch", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    emitHostEvent.mockClear();
    roots.clear();
    setWatchRootForTest((root, onChange) => {
      roots.set(root, onChange);

      return () => roots.delete(root);
    });
  });

  afterEach(() => {
    for (const id of ["c1", "c2", "c3"]) {
      closeConnection(id);
    }
    setWatchRootForTest(null);
    vi.useRealTimers();
  });

  it("watches the worktree and the common git dir, nothing else", () => {
    hold("c1");
    expect([...roots.keys()].sort()).toEqual(["/r/.git", "/w/feature"]);
  });

  it("does nothing for a local caller", () => {
    holdRepoWatch("s1", linked);
    expect(watchedSessions().size).toBe(0);
    expect(roots.size).toBe(0);
  });

  it("shares one watch between connections and stops after the last", () => {
    hold("c1");
    hold("c1");
    hold("c2");
    expect(watchedSessions().get("s1")).toBe(2);
    expect(roots.size).toBe(2);

    closeConnection("c1");
    expect(watchedSessions().get("s1")).toBe(1);
    expect(roots.size).toBe(2);

    closeConnection("c2");
    expect(watchedSessions().has("s1")).toBe(false);
    expect(roots.size).toBe(0);
  });

  it("drops a pending broadcast when the last holder disconnects", () => {
    hold("c1");
    change("/w/feature/a.ts");
    closeConnection("c1");
    vi.advanceTimersByTime(MAX_WAIT_MS);
    expect(emitHostEvent).not.toHaveBeenCalled();
  });

  it("debounces a burst into one broadcast", () => {
    hold("c1");
    change("/w/feature/a.ts");
    vi.advanceTimersByTime(DEBOUNCE_MS - 50);
    change("/w/feature/b.ts");
    change("/r/.git/refs/heads/feature");
    expect(emitHostEvent).not.toHaveBeenCalled();
    vi.advanceTimersByTime(DEBOUNCE_MS);
    expect(emitHostEvent).toHaveBeenCalledTimes(1);
    expect(emitHostEvent).toHaveBeenCalledWith("git_status_changed", {
      sessionId: "s1",
    });
  });

  it("still broadcasts during a steady stream of writes", () => {
    hold("c1");
    for (let t = 0; t < MAX_WAIT_MS + DEBOUNCE_MS; t += 100) {
      change("/w/feature/a.ts");
      vi.advanceTimersByTime(100);
    }
    expect(emitHostEvent).toHaveBeenCalledTimes(1);
  });

  it("ignores sibling worktrees and scratch files", () => {
    hold("c1");
    change("/r/.git/worktrees/other/index");
    change("/r/.git/objects/ab/cd");
    change("/r/.git/worktrees/feature/argus-scratch/todo");
    vi.advanceTimersByTime(MAX_WAIT_MS);
    expect(emitHostEvent).not.toHaveBeenCalled();
  });

  it("swallows the index refresh of a runner call, not other changes", () => {
    hold("c1");
    const end = beginRunnerRun("s1");
    change("/r/.git/worktrees/feature/index");
    end();
    change("/r/.git/worktrees/feature/index.lock");
    vi.advanceTimersByTime(MAX_WAIT_MS);
    expect(emitHostEvent).not.toHaveBeenCalled();

    const end2 = beginRunnerRun("s1");
    change("/w/feature/a.ts");
    end2();
    vi.advanceTimersByTime(MAX_WAIT_MS);
    expect(emitHostEvent).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(MAX_WAIT_MS);
    change("/r/.git/worktrees/feature/index");
    vi.advanceTimersByTime(DEBOUNCE_MS);
    expect(emitHostEvent).toHaveBeenCalledTimes(2);
  });
});

describe("holdRepoWatch on disk", () => {
  let base: string;

  afterEach(async () => {
    closeConnection("disk");
    await fs.promises.rm(base, { recursive: true, force: true });
  });

  it("broadcasts a file edit in the worktree, not one in a sibling", async () => {
    emitHostEvent.mockClear();
    base = await fs.promises.realpath(
      await fs.promises.mkdtemp(path.join(os.tmpdir(), "argus-gitwatch-")),
    );
    const repo = path.join(base, "repo");
    const sh = (cwd: string, ...args: string[]) =>
      execFileSync("git", args, { cwd, encoding: "utf8" });
    await fs.promises.mkdir(repo);
    sh(repo, "init", "-q", "-b", "main");
    sh(
      repo,
      "-c",
      "user.email=t@e",
      "-c",
      "user.name=T",
      "commit",
      "-q",
      "--allow-empty",
      "-m",
      "init",
    );
    const feature = path.join(base, "feature");
    const other = path.join(base, "other");
    sh(repo, "worktree", "add", "-q", "-b", "feature", feature);
    sh(repo, "worktree", "add", "-q", "-b", "other", other);

    runInConnection("disk", () =>
      holdRepoWatch("s1", {
        worktree: feature,
        gitDir: path.join(repo, ".git", "worktrees", "feature"),
        commonGitDir: path.join(repo, ".git"),
      }),
    );
    // Let FSEvents settle so the worktree setup above doesn't count.
    await new Promise((r) => setTimeout(r, 500));
    emitHostEvent.mockClear();

    await fs.promises.writeFile(path.join(other, "b.txt"), "b\n");
    sh(other, "add", "b.txt");
    await new Promise((r) => setTimeout(r, MAX_WAIT_MS));
    expect(emitHostEvent).not.toHaveBeenCalled();

    await fs.promises.writeFile(path.join(feature, "a.txt"), "a\n");
    await vi.waitFor(
      () =>
        expect(emitHostEvent).toHaveBeenCalledWith("git_status_changed", {
          sessionId: "s1",
        }),
      { timeout: 5000 },
    );
  }, 15_000);
});
