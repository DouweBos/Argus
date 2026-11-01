import { beforeEach, describe, expect, it, vi } from "vitest";

const agents = new Map<string, unknown>();
vi.mock("../../../state", () => ({ appState: { agents } }));
vi.mock("../../session/manager", () => ({
  forkChatInSession: vi.fn(async () => ({ claude_session_id: "cli-fork" })),
  forkSession: vi.fn(async () => ({
    session: { id: "session-2" },
    claude_session_id: "cli-fork",
  })),
}));
vi.mock("../agentService", () => ({
  launchAgent: vi.fn(async () => ({ agent_id: "agent-2" })),
  setAgentEffort: vi.fn(async () => {}),
}));
vi.mock("./actions", () => ({
  agentForkPoint: vi.fn(() => ({
    timestampMs: 1,
    turnNumber: 1,
    claudeSessionId: "cli-1",
    replayOps: [],
  })),
  seedForkedConversation: vi.fn(),
}));

const { launchAgent, setAgentEffort } = vi.mocked(
  await import("../agentService"),
);
const { forkChatAt } = await import("./forkAt");

describe("forkChatAt", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    agents.clear();
  });

  it("starts the fork on the source's runner, model, mode and effort", async () => {
    agents.set("agent-1", {
      sessionId: "session-1",
      model: "haiku",
      permissionMode: "plan",
      effort: "low",
      runner: { id: "claude-code" },
    });

    await forkChatAt("agent-1", "m1", "agent");

    expect(launchAgent).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: "session-1",
        model: "haiku",
        permissionMode: "plan",
        runnerId: "claude-code",
        resumeSessionId: "cli-fork",
      }),
    );
    expect(setAgentEffort).toHaveBeenCalledWith("agent-2", "low");
  });

  it("leaves an unset model and effort to the host's defaults", async () => {
    agents.set("agent-1", {
      sessionId: "session-1",
      model: null,
      permissionMode: null,
      runner: { id: "claude-code" },
    });

    await forkChatAt("agent-1", "m1", "session", { description: "Try again" });

    expect(launchAgent).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: "session-2",
        model: undefined,
        permissionMode: undefined,
      }),
    );
    expect(setAgentEffort).not.toHaveBeenCalled();
  });
});
