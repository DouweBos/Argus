import { beforeEach, describe, expect, it, vi } from "vitest";

const startAgent = vi.fn();
const waitForSessionReady = vi.fn();
const emitHostEvent = vi.fn();

vi.mock("@argus/host/bus", () => ({
  emitHostEvent: (...args: unknown[]) => emitHostEvent(...args),
}));

vi.mock("../../agent/agentService", () => ({
  sendAgentMessage: vi.fn(),
  startAgent: (...args: unknown[]) => startAgent(...args),
}));
vi.mock("../../mcp/projects", () => ({ ensureRepoRegistered: vi.fn() }));
vi.mock("../../session/manager", () => ({
  createSession: vi.fn(async () => ({ id: "s1" })),
}));
vi.mock("../../session/waitForReady", () => ({
  waitForSessionReady: (...args: unknown[]) => waitForSessionReady(...args),
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
    waitForSessionReady.mockRejectedValue(
      "Session s1 failed to initialize: mise.toml is not trusted",
    );
  });

  const propose = () =>
    createProposal({
      run_id: "r1",
      automation_id: "a1",
      title: "Scroll the search pivot row",
      summary: "Scroll it before focusing.",
      confidence: 0.9,
      rationale: "Focus lands offscreen.",
      recommended_action: "review",
      repo_root: "/src/app",
    });

  it("puts the starting prompt in the transcript", async () => {
    waitForSessionReady.mockResolvedValue(undefined);
    startAgent.mockResolvedValue({ agent_id: "ag1", session_id: "s1" });

    await acceptProposal(propose().id);

    const bubble = emitHostEvent.mock.calls.find(
      ([channel]) => channel === "agent:remote-message:ag1",
    );
    expect(bubble?.[1]).toMatchObject({ author: "Automation" });
    expect((bubble?.[1] as { message: string }).message).toContain(
      "Scroll the search pivot row",
    );
  });

  it("releases the proposal when its session fails to set up", async () => {
    const proposal = propose();

    await expect(acceptProposal(proposal.id)).rejects.toMatch("not trusted");

    expect(startAgent).not.toHaveBeenCalled();
    expect(requireProposal(proposal.id).session_id).toBeNull();
    expect(requireProposal(proposal.id).status).toBe("pending");
    expect(requireProposal(proposal.id).start_stage).toBeNull();
    expect(requireProposal(proposal.id).start_error).toContain("not trusted");
  });
});
