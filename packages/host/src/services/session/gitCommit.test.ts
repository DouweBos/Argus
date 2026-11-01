/** The commit options a phone can ask for: sign-off and a signing key check. */

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@argus/host/bus", () => ({ emitHostEvent: vi.fn() }));

const { appState } = await import("../../state");
const { canSignCommits, getGitAuthor, gitCommit } =
  await import("./sessionOps");

let repo: string;

function git(...args: string[]): string {
  return execFileSync("git", args, { cwd: repo, encoding: "utf8" });
}

describe("gitCommit options", () => {
  beforeEach(() => {
    // A developer's own signing key must not leak into the check.
    vi.stubEnv("GIT_CONFIG_GLOBAL", "/dev/null");
    repo = fs.realpathSync(
      fs.mkdtempSync(path.join(os.tmpdir(), "argus-commit-")),
    );
    git("init", "-q", "-b", "main");
    git("config", "user.name", "Ada");
    git("config", "user.email", "ada@example.com");
    git("config", "commit.gpgsign", "false");
    appState.sessions.set("s", {
      id: "s",
      kind: "worktree",
      branch: "main",
      display_name: null,
      description: "",
      path: repo,
      repo_root: repo,
      status: "ready",
      env_index: null,
      base_branch: null,
    });
    fs.writeFileSync(path.join(repo, "a.txt"), "a");
    git("add", "-A");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    appState.sessions.clear();
    fs.rmSync(repo, { recursive: true, force: true });
  });

  it("adds a Signed-off-by trailer when asked", async () => {
    await gitCommit("s", "feat: a", false, { signOff: true });
    expect(git("log", "-1", "--format=%B")).toContain(
      "Signed-off-by: Ada <ada@example.com>",
    );
  });

  it("leaves the trailer off by default", async () => {
    await gitCommit("s", "feat: a", false);
    expect(git("log", "-1", "--format=%B")).not.toContain("Signed-off-by");
  });

  it("reports the identity and whether a signing key is set", async () => {
    await expect(getGitAuthor("s")).resolves.toEqual([
      "Ada",
      "ada@example.com",
    ]);
    await expect(canSignCommits("s")).resolves.toBe(false);
    git("config", "user.signingkey", "ABC123");
    await expect(canSignCommits("s")).resolves.toBe(true);
  });
});
