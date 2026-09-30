import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { removeWorktree } from "./git";

let tmp: string;
let repoRoot: string;
let wt: string;

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

describe("removeWorktree", () => {
  beforeEach(() => {
    tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "argus-rm-")));
    repoRoot = path.join(tmp, "repo");
    wt = path.join(tmp, "wt");
    fs.mkdirSync(repoRoot);
    git(repoRoot, ["init", "-q", "."]);
    fs.writeFileSync(path.join(repoRoot, "a.txt"), "hi", "utf8");
    git(repoRoot, ["add", "-A"]);
    git(repoRoot, ["commit", "-qm", "init"]);
    git(repoRoot, ["worktree", "add", "-q", "-b", "feature", wt, "HEAD"]);
  });

  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("removes a registered worktree with uncommitted files", async () => {
    fs.writeFileSync(path.join(wt, "dirty.txt"), "x", "utf8");

    await removeWorktree(repoRoot, wt);

    expect(fs.existsSync(wt)).toBe(false);
    expect(git(repoRoot, ["worktree", "list"])).not.toContain(wt);
  });

  it("deletes the directory when git refuses to remove it", async () => {
    // A registered worktree without its `.git` file fails git's validation.
    fs.rmSync(path.join(wt, ".git"));

    await removeWorktree(repoRoot, wt);

    expect(fs.existsSync(wt)).toBe(false);
    expect(git(repoRoot, ["worktree", "list"])).not.toContain(wt);
  });

  it("deletes a leftover directory git no longer knows about", async () => {
    git(repoRoot, ["worktree", "remove", "--force", wt]);
    fs.mkdirSync(wt);
    fs.writeFileSync(path.join(wt, ".env.template"), "x", "utf8");

    await removeWorktree(repoRoot, wt);

    expect(fs.existsSync(wt)).toBe(false);
  });
});
