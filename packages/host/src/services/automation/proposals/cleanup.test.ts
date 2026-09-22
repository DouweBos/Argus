/**
 * The destructive button. What matters here is what it refuses: a proposal
 * already decided on, a repo Argus has no project root for, and a `-D` nobody
 * asked for.
 */

import type { ProposalCtaInput } from "./models";
import type { Session } from "../../session/models";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { appState } from "../../../state";

const gitDeleteBranch =
  vi.fn<
    (id: string, opts: { name: string; force?: boolean }) => Promise<void>
  >();
const deleteSession = vi.fn<(id: string, branch?: boolean) => Promise<void>>();

vi.mock("../../session/gitBranchOps", () => ({
  gitDeleteBranch: (id: string, opts: { name: string; force?: boolean }) =>
    gitDeleteBranch(id, opts),
}));
vi.mock("../../session/manager", () => ({
  deleteSession: (id: string, branch?: boolean) => deleteSession(id, branch),
}));

const { createProposal, dismissProposal, resetProposalCache } =
  await import("./manager");
const { performProposalCleanup } = await import("./cleanup");

let home: string;
let previousHome: string | undefined;

function input(cta: ProposalCtaInput) {
  return {
    run_id: "r1",
    automation_id: "a1",
    title: "douwe/refactor landed in staging",
    summary: "All six commits are in `origin/staging` by patch id.",
    confidence: 0.95,
    rationale: "Nothing would be lost.",
    recommended_action: "review" as const,
    repo_root: "/src/app",
    cta,
  };
}

function registerProjectRoot(repoRoot: string): void {
  appState.sessions.set("root-1", {
    id: "root-1",
    kind: "project_root",
    repo_root: repoRoot,
    path: repoRoot,
  } as Session);
}

describe("performProposalCleanup", () => {
  beforeEach(() => {
    previousHome = process.env.ARGUS_HOME;
    home = fs.mkdtempSync(path.join(os.tmpdir(), "argus-cleanup-"));
    process.env.ARGUS_HOME = home;
    resetProposalCache();
    appState.sessions.clear();
    vi.clearAllMocks();
  });

  afterEach(() => {
    appState.sessions.clear();
    if (previousHome === undefined) {
      delete process.env.ARGUS_HOME;
    } else {
      process.env.ARGUS_HOME = previousHome;
    }
    fs.rmSync(home, { force: true, recursive: true });
  });

  it("deletes the branch through the project root and accepts the proposal", async () => {
    registerProjectRoot("/src/app");
    const proposal = createProposal(
      input({
        kind: "delete_branch",
        label: "Delete the branch",
        branch: "douwe/refactor",
        force: true,
      }),
    );

    const done = await performProposalCleanup(proposal.id);

    expect(gitDeleteBranch).toHaveBeenCalledWith("root-1", {
      name: "douwe/refactor",
      force: true,
    });
    expect(done.status).toBe("accepted");
  });

  it("uses -d unless the run argued for -D", async () => {
    registerProjectRoot("/src/app");
    const proposal = createProposal(
      input({
        kind: "delete_branch",
        label: "Delete the branch",
        branch: "douwe/refactor",
      }),
    );

    await performProposalCleanup(proposal.id);

    expect(gitDeleteBranch).toHaveBeenCalledWith("root-1", {
      name: "douwe/refactor",
      force: false,
    });
  });

  it("refuses when the project is not open in Argus", async () => {
    const proposal = createProposal(
      input({
        kind: "delete_branch",
        label: "Delete the branch",
        branch: "douwe/refactor",
      }),
    );

    await expect(performProposalCleanup(proposal.id)).rejects.toContain(
      "not open in Argus",
    );
    expect(gitDeleteBranch).not.toHaveBeenCalled();
  });

  it("retires a session without taking its branch with it", async () => {
    const proposal = createProposal(
      input({
        kind: "delete_session",
        label: "Retire it",
        session_id: "s-9",
      }),
    );

    await performProposalCleanup(proposal.id);

    expect(deleteSession).toHaveBeenCalledWith("s-9", false);
  });

  it("refuses a proposal that was already decided on", async () => {
    registerProjectRoot("/src/app");
    const proposal = createProposal(
      input({
        kind: "delete_branch",
        label: "Delete the branch",
        branch: "douwe/refactor",
      }),
    );
    dismissProposal(proposal.id, "I'll keep it");

    await expect(performProposalCleanup(proposal.id)).rejects.toContain(
      "already dismissed",
    );
    expect(gitDeleteBranch).not.toHaveBeenCalled();
  });

  it("refuses a proposal whose button is not a cleanup", async () => {
    const proposal = createProposal(
      input({ kind: "open_url", label: "Open it", url: "https://x/1" }),
    );

    await expect(performProposalCleanup(proposal.id)).rejects.toContain(
      "not a cleanup",
    );
  });
});
