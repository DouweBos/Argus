/**
 * A push or pull tells every session of the repo its status moved — a linked
 * worktree's push rewrites refs its own git watcher never sees.
 */

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@argus/host/bus", () => ({ emitHostEvent: vi.fn() }));

const { emitHostEvent } = vi.mocked(await import("@argus/host/bus"));
const { appState } = await import("../../state");
const { gitPullV2, gitPushV2 } = await import("./gitPushPull");

let tmp: string;
let repo: string;
let worktree: string;

function git(cwd: string, ...args: string[]): void {
  execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", ...args], {
    cwd,
    stdio: "ignore",
  });
}

function addSession(id: string, dir: string, branch: string) {
  appState.sessions.set(id, {
    id,
    kind: id === "root" ? "project_root" : "worktree",
    branch,
    display_name: null,
    description: "",
    path: dir,
    repo_root: repo,
    status: "ready",
    env_index: null,
    base_branch: null,
  });
}

describe("gitPushPull", () => {
  beforeEach(() => {
    tmp = fs.realpathSync(
      fs.mkdtempSync(path.join(os.tmpdir(), "argus-push-pull-")),
    );
    const remote = path.join(tmp, "remote.git");
    repo = path.join(tmp, "repo");
    worktree = path.join(tmp, "wt");
    git(tmp, "init", "-q", "--bare", "-b", "main", remote);
    git(tmp, "clone", "-q", remote, repo);
    git(repo, "commit", "-q", "--allow-empty", "-m", "init");
    git(repo, "push", "-q", "-u", "origin", "main");
    git(repo, "worktree", "add", "-q", "-b", "feature", worktree);
    git(worktree, "commit", "-q", "--allow-empty", "-m", "work");
    addSession("root", repo, "main");
    addSession("wt", worktree, "feature");
    appState.sessions.set("other", {
      ...appState.sessions.get("root")!,
      id: "other",
      repo_root: path.join(tmp, "elsewhere"),
    });
    emitHostEvent.mockClear();
  });

  afterEach(() => {
    appState.sessions.clear();
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("announces every session of the repo after a push", async () => {
    await gitPushV2("wt", { setUpstream: true });

    expect(emitHostEvent).toHaveBeenCalledWith("git_status_changed", {
      sessionId: "root",
    });
    expect(emitHostEvent).toHaveBeenCalledWith("git_status_changed", {
      sessionId: "wt",
    });
    expect(emitHostEvent).not.toHaveBeenCalledWith("git_status_changed", {
      sessionId: "other",
    });
  });

  it("announces after a failed pull too", async () => {
    await expect(
      gitPullV2("wt", { strategy: "ff-only", remote: "nowhere" }),
    ).rejects.toBeDefined();

    expect(emitHostEvent).toHaveBeenCalledWith("git_status_changed", {
      sessionId: "wt",
    });
  });
});
