import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { defaultBranchFirst, readDefaultBranch } from "./defaultBranch";

describe("defaultBranchFirst", () => {
  it("moves the default branch to the front and keeps the rest in order", () => {
    expect(defaultBranchFirst(["a", "b", "main", "z"], "main")).toEqual([
      "main",
      "a",
      "b",
      "z",
    ]);
  });

  it("matches the origin ref of the default branch", () => {
    expect(defaultBranchFirst(["origin/a", "origin/main"], "main")).toEqual([
      "origin/main",
      "origin/a",
    ]);
  });

  it("leaves the list alone without a default, or when it isn't listed", () => {
    expect(defaultBranchFirst(["b", "a"], null)).toEqual(["b", "a"]);
    expect(defaultBranchFirst(["b", "a"], "main")).toEqual(["b", "a"]);
  });
});

describe("readDefaultBranch", () => {
  function repo(): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "argus-default-branch-"));
    execFileSync("git", ["init", "-q", "-b", "trunk", dir]);

    return dir;
  }

  it("follows origin/HEAD", async () => {
    const dir = repo();
    execFileSync("git", [
      "-C",
      dir,
      "symbolic-ref",
      "refs/remotes/origin/HEAD",
      "refs/remotes/origin/trunk",
    ]);

    await expect(readDefaultBranch(dir, ["a", "main", "trunk"])).resolves.toBe(
      "trunk",
    );
  });

  it("falls back to main, then master, without a remote", async () => {
    const dir = repo();

    await expect(readDefaultBranch(dir, ["a", "master", "main"])).resolves.toBe(
      "main",
    );
    await expect(readDefaultBranch(dir, ["a", "master"])).resolves.toBe(
      "master",
    );
    await expect(readDefaultBranch(dir, ["a"])).resolves.toBeNull();
  });
});
