import type { Session } from "../session/models";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { appState } from "../../state";
import { createCheckpoint, restoreCheckpoint } from "./checkpoints";

const env = {
  ...process.env,
  GIT_AUTHOR_NAME: "Test",
  GIT_AUTHOR_EMAIL: "test@example.com",
  GIT_COMMITTER_NAME: "Test",
  GIT_COMMITTER_EMAIL: "test@example.com",
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_CONFIG_SYSTEM: "/dev/null",
};

function git(args: string[]): string {
  return execFileSync("git", args, { cwd: repo, encoding: "utf8", env });
}

function write(name: string, text: string): void {
  fs.writeFileSync(path.join(repo, name), text, "utf8");
}

let tmp: string;
let repo: string;

describe("checkpoints", { timeout: 30_000 }, () => {
  beforeEach(() => {
    tmp = fs.realpathSync(
      fs.mkdtempSync(path.join(os.tmpdir(), "argus-turns-")),
    );
    repo = path.join(tmp, "repo");
    fs.mkdirSync(repo);
    git(["init", "-q", "-b", "main", "."]);
    write(".gitignore", "ignored.txt\n");
    write("a.txt", "a\n");
    git(["add", "-A"]);
    git(["commit", "-qm", "init"]);
    git(["checkout", "-qb", "feature"]);
    appState.sessions.set("s1", {
      id: "s1",
      kind: "worktree",
      path: repo,
      repo_root: repo,
      base_branch: "main",
    } as Session);
  });

  afterEach(() => {
    appState.sessions.delete("s1");
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("snapshots untracked files and leaves ignored ones and the index alone", async () => {
    write("new.txt", "untracked\n");
    write("ignored.txt", "secret\n");
    const cp = await createCheckpoint("s1");

    expect(cp.hasChanges).toBe(true);
    expect(git(["ls-tree", "--name-only", cp.sha]).split("\n")).toContain(
      "new.txt",
    );
    expect(git(["ls-tree", "--name-only", cp.sha])).not.toContain(
      "ignored.txt",
    );
    expect(git(["status", "--porcelain"])).toContain("?? new.txt");
  });

  it("restores a checkpoint without deleting files that were untracked at the time", async () => {
    write("new.txt", "untracked\n");
    const cp = await createCheckpoint("s1");
    write("new.txt", "edited\n");
    write("later.txt", "later\n");

    await restoreCheckpoint("s1", cp.id);

    expect(fs.readFileSync(path.join(repo, "new.txt"), "utf8")).toBe(
      "untracked\n",
    );
    expect(fs.existsSync(path.join(repo, "later.txt"))).toBe(false);
  });
});
