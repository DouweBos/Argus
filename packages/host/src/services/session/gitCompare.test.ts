import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { appState } from "../../state";
import { gitCompareBranches, mergeWouldConflict } from "./gitCompare";

describe("mergeWouldConflict", () => {
  let repo: string;
  const run = (...args: string[]) =>
    execFileSync("git", args, { cwd: repo, stdio: "pipe" });

  beforeAll(() => {
    repo = mkdtempSync(join(tmpdir(), "argus-compare-"));
    run("init", "-q", "-b", "main");
    run("config", "user.name", "Test");
    run("config", "user.email", "test@example.com");
    run("config", "commit.gpgsign", "false");
    writeFileSync(join(repo, "a.txt"), "base\n");
    run("add", ".");
    run("commit", "-qm", "base");
    for (const [branch, text] of [
      ["left", "left\n"],
      ["right", "right\n"],
    ]) {
      run("switch", "-qc", branch, "main");
      writeFileSync(join(repo, "a.txt"), text);
      run("commit", "-qam", branch);
    }
    run("switch", "-qc", "clean", "main");
    writeFileSync(join(repo, "b.txt"), "other\n");
    run("add", ".");
    run("commit", "-qm", "clean");
  });

  afterAll(() => rmSync(repo, { recursive: true, force: true }));

  it("sees two branches editing the same line", async () => {
    await expect(mergeWouldConflict(repo, "left", "right")).resolves.toBe(true);
  });

  it("passes a clean merge", async () => {
    await expect(mergeWouldConflict(repo, "left", "clean")).resolves.toBe(
      false,
    );
  });

  it("lists the commits only each side has", async () => {
    appState.sessions.set("cmp", {
      id: "cmp",
      kind: "project_root",
      branch: "main",
      repo_root: repo,
      path: repo,
      description: "",
      status: "ready",
      env_index: null,
      base_branch: null,
    });
    const result = await gitCompareBranches("cmp", {
      left: "left",
      right: "clean",
    });
    appState.sessions.delete("cmp");

    expect(result.leftOnly.map((c) => c.subject)).toEqual(["left"]);
    expect(result.rightOnly.map((c) => c.subject)).toEqual(["clean"]);
    expect(result.leftOnly[0].hash).toMatch(/^[0-9a-f]{40}$/);
    expect(result.wouldConflict).toBe(false);
  });
});
