/**
 * Stacked sessions against real git: three worktrees stacked main ← a ← b ← c,
 * a bare `origin`, and a fake `gh` that records what it was asked to do.
 */

import type { Session } from "./models";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { appState } from "../../state";

vi.mock("@argus/host/bus", () => ({ emitHostEvent: vi.fn() }));
vi.mock("../telemetry/telemetry", () => ({ capture: vi.fn() }));
const openPrs = new Map<string, number>();
vi.mock("../github/sessionPullRequests", () => ({
  sessionPullRequest: (id: string) =>
    openPrs.has(id)
      ? { number: openPrs.get(id), state: "open", url: "https://x" }
      : null,
  sessionPullRequestMayHaveChanged: vi.fn(),
}));

const { saveMetadata } = await import("./metadata");
const { restackSession, stackDescendants, stackRoot } = await import("./stack");
const { landStack } = await import("./stackLand");

let tmp: string;
let repoRoot: string;
let ghLog: string;

function git(cwd: string, args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
}

function commit(cwd: string, file: string, content: string, msg: string) {
  fs.writeFileSync(path.join(cwd, file), content);
  git(cwd, ["add", "-A"]);
  git(cwd, ["commit", "-q", "-m", msg]);
}

function addSession(id: string, base: string, parent: string | null): Session {
  const wt = path.join(tmp, `wt-${id}`);
  git(repoRoot, ["worktree", "add", "-q", "-b", id, wt, base]);
  const session: Session = {
    id,
    kind: "worktree",
    branch: id,
    description: "",
    path: wt,
    repo_root: repoRoot,
    status: "ready",
    base_branch: base,
    parent_session_id: parent,
  };
  appState.sessions.set(id, session);

  return session;
}

function persist(stackBases: Record<string, string>) {
  const meta = new Map(
    [...appState.sessions.values()].map((s) => [
      s.path,
      {
        id: s.id,
        description: "",
        base_branch: s.base_branch,
        parent_session_id: s.parent_session_id,
        stack_base: stackBases[s.id] ?? null,
      },
    ]),
  );
  saveMetadata(repoRoot, meta);
}

/** Subjects from `base` (exclusive) to the branch tip, oldest first. */
function subjects(cwd: string, range: string): string[] {
  return git(cwd, ["log", "--reverse", "--format=%s", range])
    .split("\n")
    .filter(Boolean);
}

describe("stacked sessions (integration)", () => {
  beforeEach(() => {
    tmp = fs.realpathSync(
      fs.mkdtempSync(path.join(os.tmpdir(), "argus-stack-")),
    );
    vi.stubEnv("ARGUS_HOME", path.join(tmp, "home"));
    for (const [k, v] of Object.entries({
      GIT_AUTHOR_NAME: "Test",
      GIT_AUTHOR_EMAIL: "test@example.com",
      GIT_COMMITTER_NAME: "Test",
      GIT_COMMITTER_EMAIL: "test@example.com",
      GIT_CONFIG_GLOBAL: "/dev/null",
      GIT_CONFIG_SYSTEM: "/dev/null",
    })) {
      vi.stubEnv(k, v);
    }
    const bin = path.join(tmp, "bin");
    fs.mkdirSync(bin);
    ghLog = path.join(tmp, "gh.log");
    fs.writeFileSync(
      path.join(bin, "gh"),
      `#!/bin/sh\necho "$@" >> "${ghLog}"\n`,
      { mode: 0o755 },
    );
    vi.stubEnv("PATH", `${bin}:${process.env.PATH ?? ""}`);

    repoRoot = path.join(tmp, "repo");
    fs.mkdirSync(repoRoot);
    git(repoRoot, ["init", "-q", "-b", "main"]);
    commit(repoRoot, "README.md", "hello\n", "initial");
    git(tmp, ["init", "-q", "--bare", "origin.git"]);
    git(repoRoot, ["remote", "add", "origin", path.join(tmp, "origin.git")]);
    git(repoRoot, ["push", "-q", "origin", "main"]);

    const a = addSession("a", "main", null);
    commit(a.path, "a.txt", "a1\n", "a: first");
    const b = addSession("b", "a", "a");
    commit(b.path, "b.txt", "b1\n", "b: first");
    const c = addSession("c", "b", "b");
    commit(c.path, "c.txt", "c1\n", "c: first");
    persist({
      b: git(repoRoot, ["rev-parse", "a"]),
      c: git(repoRoot, ["rev-parse", "b"]),
    });
    for (const id of ["a", "b", "c"]) {
      git(repoRoot, ["push", "-q", "origin", id]);
    }
  }, 60_000);

  afterEach(() => {
    appState.sessions.clear();
    openPrs.clear();
    vi.unstubAllEnvs();
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  describe("stack shape", () => {
    it("finds the bottom and the sessions above it", () => {
      expect(stackRoot("c").id).toBe("a");
      expect(stackDescendants("a").map((s) => s.id)).toEqual(["b", "c"]);
    });
  });

  describe("restackSession", () => {
    it("moves the whole stack onto an amended bottom without replaying it", async () => {
      const a = appState.sessions.get("a")!;
      commit(a.path, "a.txt", "a2\n", "a: second");
      // Rewrite the bottom: the old `a: first` must not come back above it.
      git(a.path, ["commit", "-q", "--amend", "-m", "a: second (amended)"]);

      const result = await restackSession("b");

      expect(result.conflict).toBeNull();
      expect(result.restacked).toEqual(["b", "c"]);
      const c = appState.sessions.get("c")!;
      expect(subjects(c.path, "main..c")).toEqual([
        "a: first",
        "a: second (amended)",
        "b: first",
        "c: first",
      ]);
      expect(git(c.path, ["merge-base", "--is-ancestor", "a", "b"])).toBe("");
      expect(git(c.path, ["merge-base", "--is-ancestor", "b", "c"])).toBe("");
    });

    it("force-pushes stacked PRs and points each at its parent", async () => {
      openPrs.set("b", 12).set("c", 13);
      const a = appState.sessions.get("a")!;
      commit(a.path, "a.txt", "a2\n", "a: second");

      const result = await restackSession("a");

      expect(result.pushed).toEqual(["b", "c"]);
      expect(git(repoRoot, ["rev-parse", "origin/c"])).toBe(
        git(repoRoot, ["rev-parse", "c"]),
      );
      expect(fs.readFileSync(ghLog, "utf8").trim().split("\n")).toEqual([
        "pr edit 12 --base a",
        "pr edit 13 --base b",
      ]);
    });

    it("stops on a conflict and leaves it paused for the resolver", async () => {
      const a = appState.sessions.get("a")!;
      commit(a.path, "b.txt", "from a\n", "a: touches b.txt");

      const result = await restackSession("a");

      expect(result.conflict).toEqual({ session_id: "b", files: ["b.txt"] });
      expect(result.restacked).toEqual([]);
      const b = appState.sessions.get("b")!;
      expect(
        fs.existsSync(git(b.path, ["rev-parse", "--git-path", "rebase-merge"])),
      ).toBe(true);
    });
  });

  describe("landStack", () => {
    it("merges bottom-up locally and moves each child onto the base", async () => {
      const result = await landStack("c", "squash");

      expect(result).toEqual({ landed: ["a", "b", "c"], stopped: null });
      expect(subjects(repoRoot, "main~3..main")).toHaveLength(3);
      expect(
        fs.existsSync(path.join(appState.sessions.get("c")!.path, "a.txt")),
      ).toBe(true);
      for (const id of ["b", "c"]) {
        expect(appState.sessions.get(id)).toMatchObject({
          base_branch: "main",
          parent_session_id: null,
        });
      }
    });

    it("merges PRs and retargets the next one at the base", async () => {
      openPrs.set("a", 1).set("b", 2);
      // The fake `gh` can't merge on GitHub; play its part on the bare remote.
      fs.writeFileSync(
        path.join(tmp, "bin", "gh"),
        `#!/bin/sh\necho "$@" >> "${ghLog}"\nif [ "$1 $2" = "pr merge" ]; then git -C "${repoRoot}" push -q origin "$(git -C "${repoRoot}" rev-parse origin/$([ "$3" = 1 ] && echo a || echo b))":main; fi\n`,
        { mode: 0o755 },
      );

      const result = await landStack("a", "keep");

      expect(result.stopped).toBeNull();
      expect(fs.readFileSync(ghLog, "utf8").trim().split("\n")).toEqual([
        "pr edit 1 --base main",
        "pr merge 1 --merge",
        "pr edit 2 --base main",
        "pr merge 2 --merge",
      ]);
    });
  });
});
