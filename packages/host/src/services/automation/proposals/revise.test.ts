/**
 * Asking for a better proposal keeps the proposal: the inbox must not go empty
 * on a "not quite", and the note has to survive to the next run's prompt.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const startAutomationRun = vi.fn(() => ({ status: "running" }));
vi.mock("../runner", () => ({
  startAutomationRun: (...args: unknown[]) =>
    startAutomationRun(...(args as [])),
}));

const { createProposal, dismissProposal, getProposal, resetProposalCache } =
  await import("./manager");
const { requestProposalRevision } = await import("./revise");

let home: string;
let previousHome: string | undefined;

function input() {
  return {
    run_id: "r1",
    automation_id: "a1",
    title: "Get PR #6478 reviewed",
    summary: "It has been sitting at REVIEW_REQUIRED.",
    confidence: 0.7,
    rationale: "Nobody is looking at it.",
    recommended_action: "review" as const,
  };
}

describe("requestProposalRevision", () => {
  beforeEach(() => {
    previousHome = process.env.ARGUS_HOME;
    home = fs.mkdtempSync(path.join(os.tmpdir(), "argus-revise-"));
    process.env.ARGUS_HOME = home;
    resetProposalCache();
    startAutomationRun.mockClear();
    startAutomationRun.mockReturnValue({ status: "running" });
  });

  afterEach(() => {
    if (previousHome === undefined) {
      delete process.env.ARGUS_HOME;
    } else {
      process.env.ARGUS_HOME = previousHome;
    }
    fs.rmSync(home, { force: true, recursive: true });
  });

  it("keeps the proposal pending and runs the automation again", async () => {
    const proposal = createProposal(input());

    const result = await requestProposalRevision(proposal.id, "  scope it  ");

    expect(result.run_started).toBe(true);
    expect(result.proposal.status).toBe("pending");
    expect(getProposal(proposal.id)?.revision_request).toBe("scope it");
    expect(startAutomationRun).toHaveBeenCalledWith("a1", expect.any(String));
  });

  it("still records the note when no run could start", async () => {
    startAutomationRun.mockReturnValue({ status: "skipped" });
    const proposal = createProposal(input());

    const result = await requestProposalRevision(proposal.id, "scope it");

    expect(result.run_started).toBe(false);
    expect(getProposal(proposal.id)?.revision_request).toBe("scope it");
  });

  it("refuses an empty note and a proposal nobody can revise", async () => {
    const proposal = createProposal(input());
    await expect(
      requestProposalRevision(proposal.id, "   "),
    ).rejects.toBeTruthy();

    dismissProposal(proposal.id, "no");
    await expect(
      requestProposalRevision(proposal.id, "scope it"),
    ).rejects.toBeTruthy();
    expect(startAutomationRun).not.toHaveBeenCalled();
  });
});
