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
import { checkMergeConflicts } from "./merge";

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
    // Pin line-ending behaviour so this self-contained repo doesn't inherit the
    // host's global core.autocrlf (true on Windows), which would normalize the
    // staged blob to match HEAD and hide staged changes from the conflict check.
    git(repoRoot, ["config", "core.autocrlf", "false"]);

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

    // TEMP DIAGNOSTIC (remove after root-causing on Windows CI): surface the
    // git state so we can see why effectiveSessionRef returns null on Windows.
    const safe = (args: string[]): string => {
      try {
        return git(repoRoot, args).trim();
      } catch (e) {
        return `ERR: ${e instanceof Error ? e.message : String(e)}`;
      }
    };
    const diag = {
      staged: safe(["diff", "--cached", "--name-only"]),
      stagedQuietExit: safe(["diff", "--cached", "--quiet"]),
      porcelain: safe(["status", "--porcelain=v1"]),
      writeTree: safe(["write-tree"]),
      autocrlf: safe(["config", "--get", "core.autocrlf"]),
    };
    expect(diag).toEqual({
      DIAGNOSTIC: "expected mismatch dumps actual values",
    });

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
