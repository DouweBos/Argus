import type { Session } from "./models";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  assertPushAllowed,
  isBranchProtected,
  landingLocks,
  saveProjectConfig,
} from "./argusConfig";

vi.mock("../telemetry/telemetry", () => ({ capture: vi.fn() }));

let home: string;
let repo: string;

/** A repo whose `origin/HEAD` points at `trunk`. */
function makeRepo(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "argus-protect-"));
  const refs = path.join(dir, ".git", "refs", "remotes", "origin");
  fs.mkdirSync(refs, { recursive: true });
  fs.writeFileSync(path.join(refs, "HEAD"), "ref: refs/remotes/origin/trunk\n");

  return dir;
}

function protect(on: boolean) {
  saveProjectConfig(repo, { protect_default_branch: on }, [
    "protect_default_branch",
  ]);
}

function session(over: Partial<Session>): Session {
  return {
    id: "s1",
    repo_root: repo,
    kind: "worktree",
    branch: "feature",
    base_branch: "trunk",
    path: repo,
    description: "",
    status: "ready",
    ...over,
  } as Session;
}

describe("protect_default_branch", () => {
  beforeEach(() => {
    home = fs.mkdtempSync(path.join(os.tmpdir(), "argus-home-"));
    vi.stubEnv("ARGUS_HOME", home);
    repo = makeRepo();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    fs.rmSync(home, { recursive: true, force: true });
    fs.rmSync(repo, { recursive: true, force: true });
  });

  it("changes nothing while off", () => {
    expect(isBranchProtected(repo, "trunk")).toBe(false);
    expect(() => assertPushAllowed(repo, "trunk")).not.toThrow();
    expect(landingLocks(repo)(session({}))).toMatchObject({
      push_locked: false,
      merge_locked: false,
    });
  });

  it("protects the default branch and refuses to push it", () => {
    protect(true);

    expect(isBranchProtected(repo, "trunk")).toBe(true);
    expect(isBranchProtected(repo, "feature")).toBe(false);
    expect(() => assertPushAllowed(repo, "trunk")).toThrow(/pull request/);
    expect(() => assertPushAllowed(repo, "feature")).not.toThrow();
  });

  it("marks sessions on and off the default branch", () => {
    protect(true);
    const locks = landingLocks(repo);

    expect(locks(session({}))).toMatchObject({
      push_locked: false,
      merge_locked: true,
    });
    expect(
      locks(
        session({ kind: "project_root", branch: "trunk", base_branch: null }),
      ),
    ).toMatchObject({ push_locked: true, merge_locked: false });
  });
});
