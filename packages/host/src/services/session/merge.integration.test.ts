/**
 * Integration tests for conflict detection — spin up a real git repo in a
 * temp dir so we can verify behaviour against actual git plumbing rather
 * than string parsers.
 */

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { checkMergeConflicts, mergeSessionIntoBase } from "./merge";

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

function write(rel: string, content: string): void {
  const full = path.join(repoRoot, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content, "utf8");
}

describe("checkMergeConflicts (integration)", () => {
  beforeEach(() => {
    repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), "argus-merge-test-"));
    git(repoRoot, ["init", "-q", "-b", "main"]);

    write("README.md", "hello\n");
    git(repoRoot, ["add", "-A"]);
    git(repoRoot, ["commit", "-q", "-m", "initial"]);

    // Branch off for the "session".
    git(repoRoot, ["checkout", "-q", "-b", "feat"]);
  });

  afterEach(() => {
    fs.rmSync(repoRoot, { recursive: true, force: true });
  });

  it("returns an empty list when branches have no overlap", async () => {
    // Touch a different file on each branch — no conflicts.
    write("feat.md", "feat\n");
    git(repoRoot, ["add", "-A"]);
    git(repoRoot, ["commit", "-q", "-m", "feat"]);

    git(repoRoot, ["checkout", "-q", "main"]);
    write("base.md", "base\n");
    git(repoRoot, ["add", "-A"]);
    git(repoRoot, ["commit", "-q", "-m", "base"]);

    const conflicts = await checkMergeConflicts(repoRoot, "feat", "main");
    expect(conflicts).toEqual([]);
  });

  it("detects a conflict between two committed branches", async () => {
    // Both branches edit README.md in incompatible ways.
    write("README.md", "hello from feat\n");
    git(repoRoot, ["add", "-A"]);
    git(repoRoot, ["commit", "-q", "-m", "feat edit"]);

    git(repoRoot, ["checkout", "-q", "main"]);
    write("README.md", "hello from main\n");
    git(repoRoot, ["add", "-A"]);
    git(repoRoot, ["commit", "-q", "-m", "main edit"]);

    const conflicts = await checkMergeConflicts(repoRoot, "feat", "main");
    expect(conflicts).toContain("README.md");
  });

  it("detects a conflict that only exists in the session's STAGED changes when wsPath is provided", async () => {
    // Advance base branch so the staged change on `feat` will conflict.
    git(repoRoot, ["checkout", "-q", "main"]);
    write("README.md", "hello from main\n");
    git(repoRoot, ["add", "-A"]);
    git(repoRoot, ["commit", "-q", "-m", "main edit"]);

    // Switch back to feat, stage a conflicting change (NOT committed).
    git(repoRoot, ["checkout", "-q", "feat"]);
    write("README.md", "hello from feat staged\n");
    git(repoRoot, ["add", "-A"]);

    // Without wsPath the check only sees committed history on the branch
    // → no conflict is reported.
    const committedOnly = await checkMergeConflicts(repoRoot, "feat", "main");
    expect(committedOnly).toEqual([]);

    // With wsPath the check synthesises a commit for the staged index and
    // now catches the conflict before the merge runs.
    const withStaged = await checkMergeConflicts(
      repoRoot,
      "feat",
      "main",
      repoRoot,
    );
    expect(withStaged).toContain("README.md");
  });
});

describe("mergeSessionIntoBase (integration)", () => {
  /** A worktree on `feat` with two commits ahead of `main`. */
  function twoCommitsAhead(): void {
    repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), "argus-merge-test-"));
    git(repoRoot, ["init", "-q", "-b", "main"]);
    write("README.md", "hello\n");
    git(repoRoot, ["add", "-A"]);
    git(repoRoot, ["commit", "-q", "-m", "initial"]);
    git(repoRoot, ["checkout", "-q", "-b", "feat"]);
    write("a.txt", "a\n");
    git(repoRoot, ["add", "-A"]);
    git(repoRoot, ["commit", "-q", "-m", "feat: add a"]);
    write("b.txt", "b\n");
    git(repoRoot, ["add", "-A"]);
    git(repoRoot, ["commit", "-q", "-m", "feat: add b"]);
  }

  function subjects(range: string): string[] {
    return git(repoRoot, ["log", range, "--pretty=%s"])
      .split("\n")
      .filter((line) => line.trim().length > 0);
  }

  beforeEach(twoCommitsAhead);

  it("keeps every commit when the strategy is keep", async () => {
    await mergeSessionIntoBase(repoRoot, repoRoot, "feat", "main", "keep");

    expect(subjects("main~2..main")).toEqual(["feat: add b", "feat: add a"]);
  });

  it("collapses the session into one commit when the strategy is squash", async () => {
    await mergeSessionIntoBase(repoRoot, repoRoot, "feat", "main", "squash");

    expect(subjects("main~1..main")).toHaveLength(1);
  });

  it("refuses a remote-tracking base before it rewrites anything", async () => {
    // The shape that ate a branch: a session created with `origin/main` as
    // its base, which git happily resolves but cannot fast-forward.
    git(repoRoot, ["update-ref", "refs/remotes/origin/main", "main"]);
    const before = git(repoRoot, ["rev-parse", "HEAD"]).trim();

    await expect(
      mergeSessionIntoBase(repoRoot, repoRoot, "feat", "origin/main", "squash"),
    ).rejects.toContain("remote-tracking ref");

    // The bug this covers: the squash ran first and the failure left the
    // session's commits already collapsed onto the wrong base.
    expect(git(repoRoot, ["rev-parse", "HEAD"]).trim()).toBe(before);
    expect(subjects("main..feat")).toEqual(["feat: add b", "feat: add a"]);
  });
});
