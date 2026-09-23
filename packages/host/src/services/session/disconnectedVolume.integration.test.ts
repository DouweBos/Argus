/**
 * The behaviour this whole feature exists for, against real git plumbing:
 * a worktree on a drive that gets disconnected must survive.
 *
 * Before these guards, one refresh of the session list was enough to destroy
 * it — `git worktree prune` drops the admin directory for anything it cannot
 * see, and after that neither remounting nor `git worktree repair` brings the
 * worktree back. A fake `/Volumes` path stands in for the drive: the code
 * decides "disconnected" from the mount point being absent, which is exactly
 * what ejecting does.
 */

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { repairOrphanedWorktrees } from "./git";
import { loadMetadata, migrateOrphaned, saveMetadata } from "./metadata";
import { resetAvailabilityCache } from "./volumeAvailability";

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

/** A path under a `/Volumes` mount point that does not exist. */
const MISSING_VOLUME = "/Volumes/ArgusTestDriveThatIsNotThere";
const missingWorktree = path.join(
  MISSING_VOLUME,
  "App-argus-worktrees/feature",
);

describe("a worktree on a disconnected drive", () => {
  beforeEach(() => {
    resetAvailabilityCache();
    repoRoot = fs.realpathSync(
      fs.mkdtempSync(path.join(os.tmpdir(), "argus-volume-test-")),
    );
    git(repoRoot, ["init", "-q", "."]);
    fs.writeFileSync(path.join(repoRoot, "a.txt"), "hi", "utf8");
    git(repoRoot, ["add", "-A"]);
    git(repoRoot, ["commit", "-qm", "init"]);
  });

  afterEach(() => {
    fs.rmSync(repoRoot, { recursive: true, force: true });
  });

  it("is not pruned out of git while the drive is away", async () => {
    // Register a worktree, then make it unreachable the way an eject does.
    const local = path.join(repoRoot, "wt");
    git(repoRoot, ["worktree", "add", "-q", "-b", "feature", local]);
    const gitdir = path.join(repoRoot, ".git/worktrees/wt");
    expect(fs.existsSync(gitdir)).toBe(true);

    // Point the registration at the absent volume, as `git worktree move`
    // would have, and take the directory away.
    fs.writeFileSync(
      path.join(gitdir, "gitdir"),
      `${path.join(missingWorktree, ".git")}\n`,
      "utf8",
    );
    fs.rmSync(local, { recursive: true, force: true });

    await repairOrphanedWorktrees(repoRoot);

    // The admin dir is what makes the worktree recoverable when the drive
    // comes back. Losing it is unrecoverable, so it must still be here.
    expect(fs.existsSync(gitdir)).toBe(true);
  });

  it("keeps its name and description in the index", () => {
    saveMetadata(
      repoRoot,
      new Map([
        [
          missingWorktree,
          {
            id: "ws-1",
            display_name: "Fix login",
            description: "on the SSD",
            branch: "feature",
            kind: "worktree" as const,
          },
        ],
      ]),
    );

    const [migrated, removed] = migrateOrphaned(
      repoRoot,
      loadMetadata(repoRoot),
    );

    expect(removed).toBe(false);
    expect(migrated.get(missingWorktree)?.display_name).toBe("Fix login");
    expect(migrated.get(missingWorktree)?.branch).toBe("feature");
  });

  it("stores the index off the drive, so a restart still finds it", () => {
    saveMetadata(
      repoRoot,
      new Map([
        [missingWorktree, { id: "ws-1", description: "", branch: "feature" }],
      ]),
    );

    // Nothing was written to the volume — that is what makes it survivable.
    expect(fs.existsSync(MISSING_VOLUME)).toBe(false);
    expect(loadMetadata(repoRoot).get(missingWorktree)?.id).toBe("ws-1");
  });
});
