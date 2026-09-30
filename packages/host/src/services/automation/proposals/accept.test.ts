import { beforeEach, describe, expect, it, vi } from "vitest";

const startAgent = vi.fn();

vi.mock("../../agent/agentService", () => ({
  sendAgentMessage: vi.fn(),
  startAgent: (...args: unknown[]) => startAgent(...args),
}));
vi.mock("../../mcp/projects", () => ({ ensureRepoRegistered: vi.fn() }));
vi.mock("../../session/manager", () => ({
  createSession: vi.fn(async () => ({ id: "s1" })),
}));
vi.mock("../../session/waitForReady", () => ({
  waitForSessionReady: vi.fn(async () => {
    throw "Session s1 failed to initialize: mise.toml is not trusted";
  }),
}));
vi.mock("../manager", () => ({ getAutomation: () => null }));
vi.mock("../../telemetry/telemetry", () => ({ capture: vi.fn() }));

const { createProposal, requireProposal, resetProposalCache } =
  await import("./manager");
const { acceptProposal } = await import("./accept");

describe("acceptProposal", () => {
  beforeEach(() => {
    resetProposalCache();
    vi.clearAllMocks();
  });

  it("releases the proposal when its session fails to set up", async () => {
    const proposal = createProposal({
      run_id: "r1",
      automation_id: "a1",
      title: "Scroll the search pivot row",
      summary: "Scroll it before focusing.",
      confidence: 0.9,
      rationale: "Focus lands offscreen.",
      recommended_action: "review",
      repo_root: "/src/app",
    });

    await expect(acceptProposal(proposal.id)).rejects.toMatch("not trusted");

    expect(startAgent).not.toHaveBeenCalled();
    expect(requireProposal(proposal.id).session_id).toBeNull();
    expect(requireProposal(proposal.id).status).toBe("pending");
    expect(requireProposal(proposal.id).start_stage).toBeNull();
    expect(requireProposal(proposal.id).start_error).toContain("not trusted");
  });
});
