import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { addWorktree } from "./git";

let tmp: string;
let repoRoot: string;

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

describe("addWorktree", () => {
  beforeEach(() => {
    tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "argus-add-")));
    repoRoot = path.join(tmp, "repo");
    fs.mkdirSync(repoRoot);
    git(repoRoot, ["init", "-q", "."]);
    fs.writeFileSync(path.join(repoRoot, "a.txt"), "hi", "utf8");
    git(repoRoot, ["add", "-A"]);
    git(repoRoot, ["commit", "-qm", "init"]);
  });

  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("keeps a worktree whose post-checkout hook fails", async () => {
    const hook = path.join(repoRoot, ".git/hooks/post-checkout");
    fs.writeFileSync(
      hook,
      "#!/bin/sh\necho 'config not trusted' >&2\nexit 1\n",
    );
    fs.chmodSync(hook, 0o755);
    const wt = path.join(tmp, "wt");

    await addWorktree(repoRoot, wt, ["-b", "feature", wt, "HEAD"]);

    expect(fs.readFileSync(path.join(wt, "a.txt"), "utf8")).toBe("hi");
  });

  it("still fails when git never created the worktree", async () => {
    const wt = path.join(tmp, "wt");

    await expect(
      addWorktree(repoRoot, wt, ["-b", "feature", wt, "no-such-ref"]),
    ).rejects.toBeTruthy();
  });
});
