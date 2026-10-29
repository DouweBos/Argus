import type * as AgentServiceModule from "./agentService";
import type { AgentSession } from "./models";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { capture, forgetLimitResume, limitResumeAt } = vi.hoisted(() => ({
  capture: vi.fn(),
  forgetLimitResume: vi.fn(),
  limitResumeAt: vi.fn<() => number | null>(),
}));

vi.mock("@argus/host/bus", () => ({ emitHostEvent: () => {} }));
vi.mock("../claudeAuth/accounts", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  resolveAccountForSession: (s: { claude_account_id?: string | null }) =>
    s?.claude_account_id ?? "default",
  getClaudeAccount: () => undefined,
}));
vi.mock("../telemetry/telemetry", () => ({ capture }));
vi.mock("./limitResume", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  forgetLimitResume,
  limitResumeAt,
}));
vi.mock("./conversation/live", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  liveConversation: () => ({ sessionId: "claude-1" }),
}));
vi.mock("./agentService", async (importOriginal) => {
  const actual = await importOriginal<typeof AgentServiceModule>();

  return { ...actual, respawnAgent: vi.fn(actual.respawnAgent) };
});

const pins: (string | null)[] = [];
vi.mock("../session/sessionOps", () => ({
  setSessionClaudeAccount: (id: string, accountId: string | null) => {
    pins.push(accountId);
    appState.sessions.get(id)!.claude_account_id = accountId;
  },
}));

// First: agentService reaches accountSwitch through a cycle, which would bind it to the unmocked respawn.
const { switchSessionClaudeAccount } = await import("./accountSwitch");
const { appState } = await import("../../state");
const { respawnAgent } = await import("./agentService");

const respawn = vi.mocked(respawnAgent);
const kill = vi.fn<() => Promise<void>>();

function addAgent(over: Partial<AgentSession> = {}): AgentSession {
  const agent = {
    agentId: "a1",
    sessionId: "s1",
    status: "idle",
    turnsCompleted: 0,
    inflightPrompts: 0,
    accountId: "personal",
    model: "claude-opus-5-5",
    turnWaiters: [],
    exitWaiters: [],
    handle: { kill, cleanup: () => {} },
    ...over,
  } as unknown as AgentSession;
  appState.agents.set("a1", agent);

  return agent;
}

/** Bring a busy agent to idle the way the stream does. */
async function goIdle(agent: AgentSession): Promise<void> {
  agent.status = "idle";
  agent.inflightPrompts = 0;
  for (const resolve of agent.turnWaiters) {
    resolve("idle");
  }
  agent.turnWaiters.length = 0;
  await new Promise((r) => setTimeout(r, 0));
}

describe("switchSessionClaudeAccount", () => {
  beforeEach(() => {
    appState.agents.clear();
    appState.sessions.clear();
    appState.agentPendingPermissions.clear();
    // No worktree path, so the respawn's spawn fails the way a real one can.
    appState.sessions.set("s1", {
      id: "s1",
      claude_account_id: "personal",
    } as never);
    pins.length = 0;
    kill.mockReset().mockResolvedValue();
    respawn.mockClear();
    capture.mockClear();
    forgetLimitResume.mockClear();
    limitResumeAt.mockReset().mockReturnValue(null);
  });

  it("restarts a fresh agent on the picked account, keeping its model", async () => {
    const agent = addAgent();

    await expect(
      switchSessionClaudeAccount("s1", "default", "a1"),
    ).rejects.toMatch(/still initializing/);

    expect(respawn).toHaveBeenCalledWith("a1", {
      keepModel: true,
      resumeRef: undefined,
    });
    expect(kill).toHaveBeenCalled();
    expect(agent.model).toBe("claude-opus-5-5");
    // Its old child is gone, so it can't keep looking alive.
    expect(agent.status).toBe("error");
  });

  it("drops the session's warm spare, which runs on the old account", async () => {
    const { fillSpare, hasSpare } = await import("./spares");
    const spare = { ...addAgent(), agentId: "warm" } as AgentSession;
    appState.agents.clear();
    spare.handle.on = () => {};
    await fillSpare("s1", async () => ({ agent: spare, configStamp: "x" }));

    await switchSessionClaudeAccount("s1", "work");

    expect(hasSpare("s1")).toBe(false);
    expect(kill).toHaveBeenCalled();
  });

  it("restores the old pin when the restart fails", async () => {
    addAgent();

    await expect(
      switchSessionClaudeAccount("s1", "default", "a1"),
    ).rejects.toBeDefined();

    expect(pins).toEqual(["default", "personal"]);
    expect(capture).toHaveBeenCalledWith(
      "agent_account_switched",
      expect.objectContaining({ success: false }),
    );
    expect(forgetLimitResume).not.toHaveBeenCalled();
  });

  it("resumes an agent with history on the new account", async () => {
    addAgent({ turnsCompleted: 2 });
    respawn.mockResolvedValueOnce();

    await switchSessionClaudeAccount("s1", "default", "a1");

    expect(pins).toEqual(["default"]);
    expect(respawn).toHaveBeenCalledWith("a1", {
      keepModel: true,
      resumeRef: "claude-1",
    });
    expect(capture).toHaveBeenCalledWith("agent_account_switched", {
      had_history: true,
      queued: false,
      after_limit: false,
      source: "picker",
      success: true,
    });
  });

  it("waits for a busy agent's turn to end, then moves it", async () => {
    const agent = addAgent({
      status: "running",
      inflightPrompts: 1,
      turnsCompleted: 1,
    });
    respawn.mockResolvedValueOnce();

    await switchSessionClaudeAccount("s1", "default", "a1");

    expect(pins).toEqual(["default"]);
    expect(respawn).not.toHaveBeenCalled();

    await goIdle(agent);

    expect(respawn).toHaveBeenCalledWith("a1", {
      keepModel: true,
      resumeRef: "claude-1",
    });
    expect(capture).toHaveBeenCalledWith(
      "agent_account_switched",
      expect.objectContaining({ queued: true, success: true }),
    );
  });

  it("treats an agent waiting on a permission as busy", async () => {
    addAgent({ turnsCompleted: 1 });
    appState.agentPendingPermissions.set("a1", new Map([["t1", {} as never]]));

    await switchSessionClaudeAccount("s1", "default", "a1");

    expect(respawn).not.toHaveBeenCalled();
    await switchSessionClaudeAccount("s1", "personal", "a1");
  });

  it("applies only the latest pick queued behind a turn", async () => {
    const agent = addAgent({ status: "running", turnsCompleted: 1 });
    respawn.mockRejectedValueOnce("spawn failed");

    await switchSessionClaudeAccount("s1", "default", "a1");
    await switchSessionClaudeAccount("s1", "work", "a1");
    expect(agent.turnWaiters).toHaveLength(1);

    await goIdle(agent);

    expect(respawn).toHaveBeenCalledTimes(1);
    // The failed move rolls back to the pin from before the first pick.
    expect(pins).toEqual(["default", "work", "personal"]);
  });

  it("drops a queued move when the agent's own account is picked again", async () => {
    const agent = addAgent({ status: "running", turnsCompleted: 1 });

    await switchSessionClaudeAccount("s1", "default", "a1");
    await switchSessionClaudeAccount("s1", "personal", "a1");
    await goIdle(agent);

    expect(respawn).not.toHaveBeenCalled();
  });

  it("cancels a pending limit auto-continue once moved", async () => {
    addAgent({ turnsCompleted: 1 });
    limitResumeAt.mockReturnValue(Date.now() + 60_000);
    respawn.mockResolvedValueOnce();

    await switchSessionClaudeAccount("s1", "default", "a1");

    expect(forgetLimitResume).toHaveBeenCalledWith("a1");
    expect(capture).toHaveBeenCalledWith(
      "agent_account_switched",
      expect.objectContaining({ after_limit: true, success: true }),
    );
  });

  it("doesn't restart an agent already on the account", async () => {
    addAgent({ accountId: "default" });

    await switchSessionClaudeAccount("s1", "default", "a1");

    expect(kill).not.toHaveBeenCalled();
  });

  it("only pins when no agent is named", async () => {
    addAgent();

    await switchSessionClaudeAccount("s1", "default");

    expect(pins).toEqual(["default"]);
    expect(kill).not.toHaveBeenCalled();
  });
});
