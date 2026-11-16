import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  busy: false,
  resume: "fork-1" as string | null,
  launch: vi.fn(),
  stop: vi.fn(async () => {}),
  create: vi.fn(),
  pin: vi.fn(),
  capture: vi.fn(),
  reseed: vi.fn(),
}));

vi.mock("../../telemetry/telemetry", () => ({ capture: h.capture }));
vi.mock("../busy", () => ({ isAgentBusy: () => h.busy }));
vi.mock("../limitResume", () => ({
  dismissLimitResume: vi.fn(),
  endLimitStall: vi.fn(),
}));
vi.mock("../agentService", () => ({
  launchAgent: h.launch,
  stopAgent: h.stop,
  setAgentEffort: vi.fn(async () => {}),
  telemetryRunner: (r: { id: string }) => r.id,
}));
vi.mock("../../session/manager", () => ({ createSession: h.create }));
vi.mock("../../session/sessionOps", () => ({ setSessionClaudeAccount: h.pin }));
vi.mock("../../session/waitForReady", () => ({
  waitForSessionReady: async () => {},
}));
vi.mock("./forkAt", () => ({ nativeFork: async () => h.resume }));
vi.mock("./folded", () => ({
  conversationOf: () => ({
    title: "Health endpoint",
    messages: [
      {
        id: "u1",
        role: "user",
        textBlocks: ["Add /health"],
        toolCalls: [],
        timestamp: 1,
      },
      {
        id: "m1",
        role: "assistant",
        textBlocks: ["Done"],
        toolCalls: [],
        timestamp: 2,
      },
    ],
  }),
}));
vi.mock("./actions", () => ({
  agentForkPoint: () => ({
    claudeSessionId: "c1",
    replayOps: [],
    timestampMs: 2,
    turnNumber: 1,
  }),
  forkSeed: () => "the chat so far",
  isClaudeRunner: () => true,
  seedForkedConversation: h.reseed,
}));

const { appState } = await import("../../../state");
const { transferAgent } = await import("./transfer");

function session(id: string, repo: string) {
  appState.sessions.set(id, {
    id,
    kind: "worktree",
    branch: `b-${id}`,
    path: `/wt/${id}`,
    repo_root: repo,
    status: "ready",
  } as never);
}

describe("transferAgent", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    appState.agents.clear();
    appState.sessions.clear();
    h.busy = false;
    h.resume = "fork-1";
    session("s1", "/repo/b");
    session("s2", "/repo/a");
    appState.agents.set("a1", {
      agentId: "a1",
      sessionId: "s1",
      runner: { id: "claude-code" },
      accountId: "work",
      model: "claude-opus-5-5",
    } as never);
    h.launch.mockImplementation(async (opts: { sessionId: string }) => {
      appState.agents.set("a2", {
        agentId: "a2",
        sessionId: opts.sessionId,
      } as never);

      return { agent_id: "a2", session_id: opts.sessionId };
    });
  });

  it("resumes the forked transcript in the other session and stops the source", async () => {
    const moved = await transferAgent("a1", { sessionId: "s2" });

    expect(moved.agent?.agent_id).toBe("a2");
    expect(h.launch).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: "s2",
        resumeSessionId: "fork-1",
        model: "claude-opus-5-5",
      }),
    );
    const started = appState.agents.get("a2")!;
    expect(started.pendingSeed).toBeUndefined();
    expect(started.pendingNote).toContain("/wt/s1");
    expect(started.pendingNote).toContain("/wt/s2 (project a, branch b-s2)");
    expect(h.stop).toHaveBeenCalledWith("a1");
    expect(h.capture).toHaveBeenCalledWith("agent_transferred", {
      runner: "claude-code",
      target: "existing_session",
      cross_project: true,
      history: "native",
      success: true,
    });
  });

  it("seeds the history when the runner can't fork its transcript", async () => {
    h.resume = null;
    await transferAgent("a1", { sessionId: "s2" });

    expect(appState.agents.get("a2")!.pendingSeed).toBe("the chat so far");
  });

  it("refuses a busy agent and its own session", async () => {
    await expect(transferAgent("a1", { sessionId: "s1" })).rejects.toBe(
      "The chat is already in this session",
    );
    h.busy = true;
    await expect(transferAgent("a1", { sessionId: "s2" })).rejects.toMatch(
      /still working/,
    );
    expect(h.launch).not.toHaveBeenCalled();
    expect(h.stop).not.toHaveBeenCalled();
  });

  it("opens a new session on the chat's account and starts the agent after setup", async () => {
    h.create.mockImplementation(async () => {
      session("s3", "/repo/a");

      return appState.sessions.get("s3");
    });
    const moved = await transferAgent("a1", { repoRoot: "/repo/a" });

    expect(moved).toEqual({ sessionId: "s3", agent: null });
    expect(h.create.mock.calls[0]![2]).toBe("Health endpoint");
    expect(h.pin).toHaveBeenCalledWith("s3", "work");
    await vi.waitFor(() => expect(h.stop).toHaveBeenCalledWith("a1"));
    expect(h.launch).toHaveBeenCalledWith(
      expect.objectContaining({ sessionId: "s3" }),
    );
  });

  it("leaves the source running when the move fails", async () => {
    h.launch.mockRejectedValue("spawn failed");
    await expect(transferAgent("a1", { sessionId: "s2" })).rejects.toBe(
      "spawn failed",
    );

    expect(h.stop).not.toHaveBeenCalled();
    expect(h.capture).toHaveBeenCalledWith(
      "agent_transferred",
      expect.objectContaining({ success: false }),
    );
  });
});
