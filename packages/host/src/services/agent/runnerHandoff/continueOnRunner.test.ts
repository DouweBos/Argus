import type { AgentConversation } from "../conversation/types";
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  busy: false,
  stalled: true,
  available: true,
  httpMcp: true as boolean | undefined,
  conversations: new Map<string, AgentConversation>(),
  launch: vi.fn(),
  submit: vi.fn(),
  reseed: vi.fn(),
  capture: vi.fn(),
  dismiss: vi.fn(),
  endStall: vi.fn(),
}));

function runner(id: string, displayName: string, baseRunnerId?: string) {
  return {
    id,
    displayName,
    baseRunnerId,
    capabilities: () => ({ supportsMcp: true }),
  };
}

const RUNNERS = {
  "claude-code": runner("claude-code", "Claude Code"),
  codex: runner("codex", "Codex"),
  cursor: runner("cursor", "Cursor"),
} as Record<string, ReturnType<typeof runner>>;

vi.mock("../../llm/registry", () => ({
  getRunnerById: (id: string) => RUNNERS[id] ?? null,
  runnerAvailability: async () =>
    new Map(
      Object.keys(RUNNERS).map((id) => [
        id,
        {
          available: h.available,
          unavailableReason: h.available ? null : "Install it",
        },
      ]),
    ),
}));
vi.mock("../../telemetry/telemetry", () => ({ capture: h.capture }));
vi.mock("../accountSwitch", () => ({ isAgentBusy: () => h.busy }));
vi.mock("../agentService", () => ({
  launchAgent: h.launch,
  telemetryRunner: (r: { id: string }) => r.id,
}));
vi.mock("../conversation/actions", () => ({ submitAgentMessage: h.submit }));
vi.mock("../conversation/folded", () => ({
  conversationOf: (id: string) => h.conversations.get(id) ?? { messages: [] },
  reseedConversation: h.reseed,
}));
vi.mock("../limitResume", () => ({
  dismissLimitResume: h.dismiss,
  endLimitStall: h.endStall,
  isLimitStalled: () => h.stalled,
}));

const { appState } = await import("../../../state");
const { continueAgentOnRunner } = await import("./continueOnRunner");

function addAgent(id: string, runnerId: string) {
  appState.agents.set(id, {
    agentId: id,
    sessionId: "s1",
    runner: RUNNERS[runnerId],
    permissionMode: "auto",
    handle: { reachesHttpMcp: () => h.httpMcp },
  } as never);
}

describe("continueAgentOnRunner", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    appState.agents.clear();
    h.conversations.clear();
    h.busy = false;
    h.stalled = true;
    h.available = true;
    h.httpMcp = true;
    addAgent("a1", "claude-code");
    h.conversations.set("a1", {
      title: "Health endpoint",
      todos: [{ content: "Write tests", status: "pending" }],
      messages: [
        {
          id: "u1",
          role: "user",
          textBlocks: ["Add /health"],
          toolCalls: [],
          timestamp: 1,
        },
      ],
    });
    h.launch.mockImplementation(async (opts: { runnerId: string }) => {
      addAgent("a2", opts.runnerId);
      h.conversations.set("a2", { messages: [], sessionId: "thread-1" });

      return { agent_id: "a2", session_id: "s1" };
    });
  });

  it("starts a seeded agent in the same session behind a handoff divider", async () => {
    const info = await continueAgentOnRunner("a1", "cursor", "limit_card");

    expect(info.agent_id).toBe("a2");
    expect(h.launch).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: "s1",
        runnerId: "cursor",
        permissionMode: "auto",
        appendSystemPrompt: undefined,
        fresh: true,
      }),
    );
    const seeded = h.reseed.mock.calls[0]![1] as AgentConversation;
    expect(seeded.sessionId).toBe("thread-1");
    expect(seeded.title).toBe("Health endpoint");
    expect(seeded.todos).toHaveLength(1);
    expect(seeded.messages[0]!.handoff).toEqual({
      fromAgentId: "a1",
      fromRunner: "Claude Code",
      toRunner: "Cursor",
    });
    const sent = h.submit.mock.calls[0]![1] as {
      text: string;
      displayText: string;
    };
    expect(sent.displayText).toBe("Continue where Claude Code left off.");
    expect(sent.text).toContain("Add /health");
    expect(h.dismiss).toHaveBeenCalledWith("a1");
    expect(h.endStall).toHaveBeenCalledWith("a1");
    expect(h.capture).toHaveBeenCalledWith(
      "agent_continued_on_runner",
      expect.objectContaining({
        seed: "mcp",
        native: false,
        success: true,
        after_limit: true,
      }),
    );
  });

  it("sends the larger inline seed when the agent can't reach HTTP MCP", async () => {
    h.httpMcp = false;
    await continueAgentOnRunner("a1", "cursor", "menu");

    const sent = h.submit.mock.calls[0]![1] as { text: string };
    expect(sent.text).not.toContain("read_agent_transcript");
    expect(h.capture).toHaveBeenCalledWith(
      "agent_continued_on_runner",
      expect.objectContaining({ seed: "inline", source: "menu" }),
    );
  });

  it("hands Codex the seed as developer instructions", async () => {
    await continueAgentOnRunner("a1", "codex", "menu");

    const opts = h.launch.mock.calls[0]![0] as { appendSystemPrompt?: string };
    expect(opts.appendSystemPrompt).toContain("Add /health");
    const sent = h.submit.mock.calls[0]![1] as { text: string };
    expect(sent.text).toBe("Continue where Claude Code left off.");
  });

  it("refuses the same runner, a busy agent, an empty chat and a missing CLI", async () => {
    await expect(
      continueAgentOnRunner("a1", "claude-code", "menu"),
    ).rejects.toMatch(/already on Claude Code/);
    h.busy = true;
    await expect(continueAgentOnRunner("a1", "codex", "menu")).rejects.toMatch(
      /still working/,
    );
    h.busy = false;
    h.conversations.set("a1", { messages: [] });
    await expect(continueAgentOnRunner("a1", "codex", "menu")).rejects.toMatch(
      /nothing to continue/,
    );
    h.conversations.set("a1", {
      messages: [
        {
          id: "u",
          role: "user",
          textBlocks: ["x"],
          toolCalls: [],
          timestamp: 1,
        },
      ],
    });
    h.available = false;
    await expect(continueAgentOnRunner("a1", "codex", "menu")).rejects.toBe(
      "Install it",
    );
    expect(h.launch).not.toHaveBeenCalled();
  });

  it("counts a failed start", async () => {
    h.launch.mockRejectedValueOnce("spawn failed");
    await expect(continueAgentOnRunner("a1", "codex", "menu")).rejects.toBe(
      "spawn failed",
    );

    expect(h.capture).toHaveBeenCalledWith(
      "agent_continued_on_runner",
      expect.objectContaining({ success: false }),
    );
    expect(h.dismiss).not.toHaveBeenCalled();
  });
});
