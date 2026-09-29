import type { AgentSession } from "./models";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@argus/host/bus", () => ({ emitHostEvent: () => {} }));
vi.mock("../claudeAuth/accounts", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  resolveAccountForSession: (s: { claude_account_id?: string | null }) =>
    s?.claude_account_id ?? "default",
}));

const pins: (string | null)[] = [];
vi.mock("../session/sessionOps", () => ({
  setSessionClaudeAccount: (id: string, accountId: string | null) => {
    pins.push(accountId);
    appState.sessions.get(id)!.claude_account_id = accountId;
  },
}));

const { appState } = await import("../../state");
const { switchSessionClaudeAccount } = await import("./agentService");

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

describe("switchSessionClaudeAccount", () => {
  beforeEach(() => {
    appState.agents.clear();
    appState.sessions.clear();
    // No worktree path, so the respawn's spawn fails the way a real one can.
    appState.sessions.set("s1", {
      id: "s1",
      claude_account_id: "personal",
    } as never);
    pins.length = 0;
    kill.mockReset().mockResolvedValue();
  });

  it("restarts a fresh agent on the picked account, keeping its model", async () => {
    const agent = addAgent();

    await expect(
      switchSessionClaudeAccount("s1", "default", "a1"),
    ).rejects.toMatch(/still initializing/);

    expect(kill).toHaveBeenCalled();
    expect(agent.model).toBe("claude-opus-5-5");
    // Its old child is gone, so it can't keep looking alive.
    expect(agent.status).toBe("error");
  });

  it("restores the old pin when the restart fails", async () => {
    addAgent();

    await expect(
      switchSessionClaudeAccount("s1", "default", "a1"),
    ).rejects.toBeDefined();

    expect(pins).toEqual(["default", "personal"]);
  });

  it("only pins when the agent has already talked", async () => {
    addAgent({ turnsCompleted: 1 });

    await switchSessionClaudeAccount("s1", "default", "a1");

    expect(pins).toEqual(["default"]);
    expect(kill).not.toHaveBeenCalled();
  });

  it("leaves an agent with its first prompt in flight alone", async () => {
    addAgent({ status: "running", inflightPrompts: 1 });

    await switchSessionClaudeAccount("s1", "default", "a1");

    expect(kill).not.toHaveBeenCalled();
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
