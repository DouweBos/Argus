import type { Session } from "../session/models";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { appState } from "../../state";

vi.mock("../session/gitSearch", () => ({
  gitSearchLog: vi.fn(async () => ({
    commits: [
      {
        hash: "abc123",
        abbreviatedHash: "abc",
        author: "Douwe",
        date: "2026-09-27T10:00:00+02:00",
        subject: "fix: thing",
        body: "",
        refs: "HEAD -> main",
      },
    ],
    nextCursor: null,
  })),
}));
vi.mock("../session/gitBranchOps", () => ({
  gitMergeBranch: vi.fn(),
  gitRebaseOnto: vi.fn(),
  gitRenameBranch: vi.fn(),
}));
vi.mock("../userProjectSettings/store", () => ({
  pinBranch: vi.fn(() => ["main"]),
  unpinBranch: vi.fn(() => []),
}));

const { gitSearchLog } = await import("../session/gitSearch");
const { gitMergeBranch } = await import("../session/gitBranchOps");
const { pinBranch } = await import("../userProjectSettings/store");
const { branchLog, mergeIntoCurrent, setBranchPinned } =
  await import("./gitRemote");

function addSession(id: string, kind: Session["kind"]): void {
  appState.sessions.set(id, {
    id,
    kind,
    path: "/repo",
    repo_root: "/repo",
  } as Session);
}

describe("gitRemote", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    appState.sessions.clear();
  });

  it("maps a branch's history onto the wire shape", async () => {
    addSession("s1", "project_root");
    const commits = await branchLog("s1", "origin/feature", 20);

    expect(gitSearchLog).toHaveBeenCalledWith("s1", {
      branch: "origin/feature",
      limit: 20,
    });
    expect(commits).toEqual([
      expect.objectContaining({ hash: "abc123", short_hash: "abc" }),
    ]);
  });

  it("refuses a ref git would read as an option", async () => {
    addSession("s1", "project_root");
    await expect(branchLog("s1", "--output=/tmp/x")).rejects.toMatch(
      /Not a branch name/,
    );
    expect(gitSearchLog).not.toHaveBeenCalled();
  });

  it("merges into the checked-out branch on the project root only", async () => {
    addSession("root", "project_root");
    addSession("wt", "worktree");

    await mergeIntoCurrent("root", "feature", true);
    expect(gitMergeBranch).toHaveBeenCalledWith("root", {
      from: "feature",
      squash: true,
    });
    await expect(mergeIntoCurrent("wt", "feature", false)).rejects.toMatch(
      /project root/,
    );
  });

  it("pins against the session's repo", () => {
    addSession("s1", "project_root");
    expect(setBranchPinned("s1", "main", true)).toEqual(["main"]);
    expect(pinBranch).toHaveBeenCalledWith("/repo", "main");
  });
});
