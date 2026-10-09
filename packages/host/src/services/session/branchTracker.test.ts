/**
 * A checkout switched outside Argus updates its session's branch and tells
 * clients — for the repo root and for a linked worktree.
 */

import type { Session } from "./models";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@argus/host/bus", () => ({ emitHostEvent: vi.fn() }));
vi.mock("./autoFetch", () => ({
  effectiveAutoFetchMinutes: () => null,
  reconfigureAutoFetch: vi.fn(),
}));

const { emitHostEvent } = vi.mocked(await import("@argus/host/bus"));
const { appState } = await import("../../state");
const {
  branchTrackerReady,
  readCheckoutBranch,
  stopAllBranchTracking,
  trackSessionBranch,
} = await import("./branchTracker");

let tmp: string;
let repo: string;

function git(cwd: string, ...args: string[]): void {
  execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", ...args], {
    cwd,
    stdio: "ignore",
  });
}

function addSession(
  id: string,
  kind: Session["kind"],
  dir: string,
  branch: string,
) {
  appState.sessions.set(id, {
    id,
    kind,
    branch,
    display_name: null,
    description: "",
    path: dir,
    repo_root: repo,
    status: "ready",
    env_index: null,
    base_branch: null,
  });
}

/** Waits for the session's branch to land, then for its update event. */
async function waitForBranch(id: string, branch: string): Promise<void> {
  await vi.waitFor(
    () => {
      expect(appState.sessions.get(id)?.branch).toBe(branch);
      expect(emitHostEvent).toHaveBeenCalledWith("session:updated", {
        id,
        repo_root: repo,
        branch,
      });
    },
    { timeout: 5000, interval: 25 },
  );
}

describe("branchTracker", () => {
  beforeEach(() => {
    tmp = fs.realpathSync(
      fs.mkdtempSync(path.join(os.tmpdir(), "argus-branch-tracker-")),
    );
    repo = path.join(tmp, "repo");
    fs.mkdirSync(repo);
    git(repo, "init", "-q", "-b", "main");
    git(repo, "commit", "-q", "--allow-empty", "-m", "init");
    appState.sessions.clear();
    emitHostEvent.mockClear();
  });

  afterEach(() => {
    stopAllBranchTracking();
    appState.sessions.clear();
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  describe("trackSessionBranch", () => {
    it("follows the repo root through checkout -b and switch", async () => {
      addSession("root", "project_root", repo, "main");
      trackSessionBranch("root");
      await branchTrackerReady("root");

      git(repo, "checkout", "-q", "-b", "x");
      await waitForBranch("root", "x");

      emitHostEvent.mockClear();
      git(repo, "switch", "-q", "main");
      await waitForBranch("root", "main");
      expect(emitHostEvent).toHaveBeenCalledWith(
        "session:branch-changed:root",
        {
          branch: "main",
        },
      );
    });

    it("follows a linked worktree through checkout -b and switch", async () => {
      const wt = path.join(tmp, "wt");
      git(repo, "worktree", "add", "-q", "-b", "feature", wt);
      addSession("wt", "worktree", wt, "feature");
      trackSessionBranch("wt");
      await branchTrackerReady("wt");

      git(wt, "checkout", "-q", "-b", "y");
      await waitForBranch("wt", "y");

      emitHostEvent.mockClear();
      git(wt, "switch", "-q", "feature");
      await waitForBranch("wt", "feature");
      expect(appState.sessions.get("wt")?.branch).toBe("feature");
    });

    it("picks up a switch made before it started watching", async () => {
      git(repo, "checkout", "-q", "-b", "elsewhere");
      addSession("root", "project_root", repo, "main");
      trackSessionBranch("root");

      await waitForBranch("root", "elsewhere");
      expect(appState.sessions.get("root")?.branch).toBe("elsewhere");
    });
  });

  describe("readCheckoutBranch", () => {
    const gitDir = () => path.join(repo, ".git");

    it("reads a branch", () => {
      expect(readCheckoutBranch(gitDir())).toBe("main");
    });

    it("says HEAD when detached", () => {
      git(repo, "checkout", "-q", "--detach");
      expect(readCheckoutBranch(gitDir())).toBe("HEAD");
    });

    it("keeps the branch being rebased", () => {
      git(repo, "checkout", "-q", "-b", "topic");
      fs.writeFileSync(path.join(repo, "f"), "topic\n");
      git(repo, "add", "f");
      git(repo, "commit", "-q", "-m", "topic");
      git(repo, "switch", "-q", "main");
      fs.writeFileSync(path.join(repo, "f"), "main\n");
      git(repo, "add", "f");
      git(repo, "commit", "-q", "-m", "main");
      try {
        git(repo, "rebase", "-q", "main", "topic");
      } catch {
        // The conflict is the point: the rebase stops part way.
      }

      expect(fs.existsSync(path.join(gitDir(), "rebase-merge"))).toBe(true);
      expect(readCheckoutBranch(gitDir())).toBe("topic");
    });
  });
});
