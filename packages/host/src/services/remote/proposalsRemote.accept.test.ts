/**
 * Accepting from a phone answers while the start is still building: a session
 * with a slow setup outlasts any request, and the card follows `start_stage`.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const acceptProposal = vi.fn();

vi.mock("../automation/proposals/accept", () => ({
  acceptProposal: (id: string) => acceptProposal(id),
}));

const { createProposal, resetProposalCache, updateProposal } =
  await import("../automation/proposals/manager");
const { acceptRemoteProposal } = await import("./proposalsRemote");

function pending() {
  return createProposal({
    run_id: "r1",
    automation_id: "a1",
    title: "Scroll the search pivot row",
    summary: "Scroll it before focusing.",
    confidence: 0.9,
    rationale: "Focus lands offscreen.",
    recommended_action: "start_session",
    repo_root: "/src/app",
  });
}

describe("acceptRemoteProposal", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    resetProposalCache();
    acceptProposal.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("answers with the stage while a slow start carries on", async () => {
    const proposal = pending();
    acceptProposal.mockImplementation(() => {
      updateProposal(proposal.id, { start_stage: "setting_up" });

      return new Promise(() => undefined);
    });

    const answer = acceptRemoteProposal(proposal.id);
    await vi.advanceTimersByTimeAsync(1500);
    const result = await answer;

    expect(result.agent_id).toBeNull();
    expect(result.proposal.start_stage).toBe("setting_up");
  });

  it("passes a refusal straight back", async () => {
    const proposal = pending();
    acceptProposal.mockRejectedValue("This proposal is already starting.");

    await expect(acceptRemoteProposal(proposal.id)).rejects.toBe(
      "This proposal is already starting.",
    );
  });
});
