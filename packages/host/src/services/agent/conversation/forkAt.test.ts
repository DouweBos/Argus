import { beforeEach, describe, expect, it, vi } from "vitest";

const agents = new Map<string, unknown>();
const sessions = new Map<string, unknown>([
  ["session-1", { id: "session-1", path: "/wt1", branch: "b1" }],
  ["session-2", { id: "session-2", path: "/wt2", branch: "b2" }],
]);
vi.mock("../../../state", () => ({ appState: { agents, sessions } }));
vi.mock("../../telemetry/telemetry", () => ({ capture: vi.fn() }));
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
  telemetryRunner: (r: { id: string }) => r.id,
}));
vi.mock("./actions", () => ({
  requireTranscriptFork: vi.fn(),
  agentForkPoint: vi.fn(() => ({
    timestampMs: 1,
    turnNumber: 1,
    claudeSessionId: "cli-1",
    replayOps: [],
  })),
  seedForkedConversation: vi.fn(),
  forkSeed: vi.fn(() => "SEED"),
  isClaudeRunner: (r: { id: string }) => r.id === "claude-code",
}));

const { launchAgent, setAgentEffort } = vi.mocked(
  await import("../agentService"),
);
const { capture } = vi.mocked(await import("../../telemetry/telemetry"));
const { seedForkedConversation } = vi.mocked(await import("./actions"));
const { forkSession } = vi.mocked(await import("../../session/manager"));
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

  it("forks Codex natively into the new session's worktree", async () => {
    const forkTranscript = vi.fn(async () => ({ resumeRef: "thread-2" }));
    agents.set("agent-1", {
      sessionId: "session-1",
      model: null,
      runner: { id: "codex", forkTranscript },
    });
    agents.set("agent-2", {});

    await forkChatAt("agent-1", "m1", "session", { description: "Again" });

    expect(forkSession).toHaveBeenCalledWith(
      "session-1",
      "",
      "Again",
      1,
      1,
      null,
      [],
    );
    expect(forkTranscript).toHaveBeenCalledWith(
      expect.objectContaining({ sourceRef: "cli-1", destCwd: "/wt2" }),
    );
    expect(launchAgent).toHaveBeenCalledWith(
      expect.objectContaining({ resumeSessionId: "thread-2" }),
    );
    expect(agents.get("agent-2")).not.toHaveProperty("pendingSeed");
    // Codex doesn't replay a turn on resume.
    expect(seedForkedConversation).toHaveBeenCalledWith(
      "agent-2",
      expect.anything(),
      "thread-2",
      false,
    );
    expect(capture).toHaveBeenCalledWith("agent_chat_forked", {
      into: "session",
      runner: "codex",
      history: "native",
    });
  });

  it("seeds the history on a runner that can't fork", async () => {
    agents.set("agent-1", {
      sessionId: "session-1",
      model: null,
      runner: { id: "gemini" },
    });
    agents.set("agent-2", {});

    await forkChatAt("agent-1", "m1", "agent");

    expect(launchAgent).toHaveBeenCalledWith(
      expect.objectContaining({ resumeSessionId: undefined }),
    );
    expect(agents.get("agent-2")).toEqual({ pendingSeed: "SEED" });
    expect(capture).toHaveBeenCalledWith(
      "agent_chat_forked",
      expect.objectContaining({ history: "seeded" }),
    );
  });
});
