/**
 * The move, against real git.
 *
 * `git worktree move` fails with "Cross-device link" onto another filesystem,
 * which is the only case this feature really cares about — so the copy +
 * `git worktree repair` path is the one that matters. These tests drive the
 * same code path within one filesystem; the cross-device fallback is verified
 * by forcing the rename to fail.
 */

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { addHostEventSink } from "../../bus";
import { appState } from "../../state";
import {
  forgetAutomationSession,
  recordAutomationSession,
} from "../automation/ownedSessions";
import { liveWorktreeRoots } from "./worktreeLocation";
import { executeWorktreeMove, planWorktreeMove } from "./worktreeMove";
import { invalidateWorktreeLocationCache } from "./worktreeRootCache";

let argusHome: string | undefined;
let repoRoot: string;
let tmp: string;

function git(cwd: string, args: string[]): string {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: "Test",
      GIT_AUTHOR_EMAIL: "test@example.com",
      GIT_COMMITTER_NAME: "Test",
      GIT_COMMITTER_EMAIL: "test@example.com",
      GIT_CONFIG_GLOBAL: "/dev/null",
      GIT_CONFIG_SYSTEM: "/dev/null",
    },
  });
}

describe("executeWorktreeMove (integration)", () => {
  beforeEach(() => {
    tmp = fs.realpathSync(
      fs.mkdtempSync(path.join(os.tmpdir(), "argus-move-")),
    );
    repoRoot = path.join(tmp, "repo");
    fs.mkdirSync(repoRoot);
    git(repoRoot, ["init", "-q", "."]);
    fs.writeFileSync(path.join(repoRoot, "a.txt"), "hi", "utf8");
    git(repoRoot, ["add", "-A"]);
    git(repoRoot, ["commit", "-qm", "init"]);
    appState.sessions.clear();
    // The move reads and writes the settings stores, and the plan only covers
    // worktrees under the resolved root — both need a throwaway ARGUS_HOME.
    argusHome = process.env.ARGUS_HOME;
    process.env.ARGUS_HOME = path.join(tmp, "argus-home");
    invalidateWorktreeLocationCache();
  });

  afterEach(() => {
    appState.sessions.clear();
    if (argusHome === undefined) {
      delete process.env.ARGUS_HOME;
    } else {
      process.env.ARGUS_HOME = argusHome;
    }
    invalidateWorktreeLocationCache();
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  function addWorktree(name: string): string {
    const wtPath = path.join(liveWorktreeRoots(repoRoot)[0], name);
    git(repoRoot, ["worktree", "add", "-q", "-b", name, wtPath]);
    appState.sessions.set(name, {
      id: name,
      kind: "worktree",
      branch: name,
      display_name: null,
      description: "",
      path: wtPath,
      repo_root: repoRoot,
      status: "ready",
    });

    return wtPath;
  }

  it("relocates a worktree and leaves it usable", async () => {
    const from = addWorktree("feature");
    // Uncommitted work must survive — that is the whole risk of moving.
    fs.writeFileSync(path.join(from, "scratch.txt"), "wip", "utf8");

    const updates: unknown[] = [];
    const stop = addHostEventSink((channel, args) => {
      if (channel === "session:updated") {
        updates.push(args[0]);
      }
    });

    const result = await executeWorktreeMove(repoRoot, path.join(tmp, "new"));
    stop();

    expect(result.failed).toEqual([]);
    expect(result.moved).toEqual(["feature"]);

    const to = path.join(result.to_root, "feature");
    expect(fs.existsSync(from)).toBe(false);
    expect(fs.readFileSync(path.join(to, "scratch.txt"), "utf8")).toBe("wip");
    // Still a working tree git can operate in, on the same branch.
    expect(git(to, ["rev-parse", "--show-toplevel"]).trim()).toBe(to);
    expect(git(to, ["rev-parse", "--abbrev-ref", "HEAD"]).trim()).toBe(
      "feature",
    );
    // And the session now points at where it actually is.
    expect(appState.sessions.get("feature")?.path).toBe(to);
    // Clients learn the new path without a restart.
    expect(updates).toEqual([{ id: "feature", path: to }]);
  });

  it("reports what is holding a worktree rather than moving it anyway", async () => {
    addWorktree("busy");
    // A linked worktree keeps its state under the repo, not in its own tree.
    fs.mkdirSync(path.join(repoRoot, ".git/worktrees/busy/rebase-merge"), {
      recursive: true,
    });

    const plan = await planWorktreeMove(repoRoot, path.join(tmp, "new"));

    expect(plan.blockers).toHaveLength(1);
    expect(plan.blockers[0]?.kind).toBe("mid_operation");
    // Blocked worktrees are not offered for the move.
    expect(plan.sessions).toHaveLength(0);
  });

  it("moves only the automation's own worktrees out of a shared root", async () => {
    // Setting an automation base for the first time: both purposes still
    // resolve to the same root, so containment alone would sweep up the
    // developer's session too.
    const mine = addWorktree("mine");
    addWorktree("theirs");
    recordAutomationSession("auto-1", "run-1", "theirs");
    const history = path.join(
      liveWorktreeRoots(repoRoot)[0],
      ".argus-chat-history",
    );
    fs.mkdirSync(history, { recursive: true });

    const result = await executeWorktreeMove(
      repoRoot,
      path.join(tmp, "bulk"),
      "automation",
    );
    forgetAutomationSession("theirs");

    expect(result.moved).toEqual(["theirs"]);
    expect(fs.existsSync(mine)).toBe(true);
    // Chat history is per project and pinned to the user root — it stays.
    expect(fs.existsSync(history)).toBe(true);
  });

  it("keeps the original when the copy cannot be verified", async () => {
    const from = addWorktree("feature");
    // A file where the destination directory needs to go: the copy fails.
    const toRoot = path.join(tmp, "new", "repo-argus-worktrees");
    fs.mkdirSync(path.dirname(toRoot), { recursive: true });
    fs.mkdirSync(toRoot, { recursive: true });
    fs.writeFileSync(path.join(toRoot, "feature"), "in the way", "utf8");

    const result = await executeWorktreeMove(repoRoot, path.join(tmp, "new"));

    expect(result.moved).toEqual([]);
    expect(result.failed).toHaveLength(1);
    // The user's work is still where they left it.
    expect(fs.existsSync(path.join(from, "a.txt"))).toBe(true);
  });
});
