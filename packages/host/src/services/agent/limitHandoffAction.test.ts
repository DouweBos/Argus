import type { AgentSession } from "./models";
import type { ClaudeAccount } from "../claudeAuth/accounts";
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  accounts: [] as ClaudeAccount[],
  stalled: true,
  emitted: [] as [string, unknown][],
  capture: vi.fn(),
  send: vi.fn(),
  respawn: vi.fn(),
  forget: vi.fn(),
}));

vi.mock("@argus/host/bus", () => ({
  emitHostEvent: (channel: string, payload: unknown) =>
    h.emitted.push([channel, payload]),
}));
vi.mock("../claudeAuth/accounts", () => ({
  listClaudeAccounts: () => h.accounts,
  getClaudeAccount: () => undefined,
  resolveAccountForSession: (s?: { claude_account_id?: string | null }) =>
    s?.claude_account_id ?? "personal",
}));
vi.mock("../usage/limits", () => ({ getAccountLimits: vi.fn() }));
vi.mock("../telemetry/telemetry", () => ({ capture: h.capture }));
vi.mock("../session/sessionOps", () => ({
  setSessionClaudeAccount: (id: string, accountId: string | null) => {
    appState.sessions.get(id)!.claude_account_id = accountId;
  },
}));
vi.mock("./agentService", () => ({
  respawnAgent: h.respawn,
  sendAgentMessage: h.send,
}));
vi.mock("./conversation/live", () => ({
  liveConversation: () => ({ sessionId: "claude-1" }),
}));
vi.mock("./limitResume", () => ({
  CONTINUE_MESSAGE: "continue",
  forgetLimitResume: h.forget,
  isLimitStalled: () => h.stalled,
  limitResumeAt: () => null,
}));

const { appState } = await import("../../state");
const { handoffAgentToAccount } = await import("./accountSwitch");

function account(id: string, over: Partial<ClaudeAccount> = {}): ClaudeAccount {
  return {
    id,
    email: `${id}@example.com`,
    account_type: "claudeai",
    created_at: 0,
    ...over,
  };
}

function addAgent(over: Partial<AgentSession> = {}): AgentSession {
  const agent = {
    agentId: "a1",
    sessionId: "s1",
    status: "idle",
    turnsCompleted: 2,
    inflightPrompts: 0,
    accountId: "personal",
    turnWaiters: [],
    ...over,
  } as unknown as AgentSession;
  appState.agents.set("a1", agent);

  return agent;
}

describe("handoffAgentToAccount", () => {
  beforeEach(() => {
    appState.agents.clear();
    appState.sessions.clear();
    appState.agentPendingPermissions.clear();
    appState.sessions.set("s1", {
      id: "s1",
      claude_account_id: "personal",
    } as never);
    h.accounts = [account("personal"), account("work")];
    h.stalled = true;
    h.emitted.length = 0;
    h.capture.mockClear();
    h.send.mockClear();
    h.forget.mockClear();
    // A respawn spawns on whatever the session is pinned to.
    h.respawn.mockReset().mockImplementation(async (agentId: string) => {
      const agent = appState.agents.get(agentId)!;
      agent.accountId =
        appState.sessions.get(agent.sessionId)!.claude_account_id ?? undefined;
    });
  });

  it("resumes the chat on the picked account and continues it", async () => {
    addAgent();

    await handoffAgentToAccount("a1", "work");

    expect(appState.sessions.get("s1")!.claude_account_id).toBe("work");
    expect(h.respawn).toHaveBeenCalledWith("a1", {
      keepModel: true,
      resumeRef: "claude-1",
    });
    expect(h.send).toHaveBeenCalledWith("a1", "continue");
    expect(h.emitted).toContainEqual([
      "agent:remote-message:a1",
      { message: "continue", author: "Argus" },
    ]);
    expect(h.forget).toHaveBeenCalledWith("a1");
    expect(h.capture).toHaveBeenCalledWith("agent_account_switched", {
      had_history: true,
      queued: false,
      after_limit: true,
      source: "limit_card",
      success: true,
    });
  });

  it("refuses an account that can't take over", async () => {
    addAgent();
    h.accounts = [account("personal"), account("work", { rate_limited: true })];

    await expect(handoffAgentToAccount("a1", "work")).rejects.toMatch(
      /can't take over/,
    );
    await expect(handoffAgentToAccount("a1", "personal")).rejects.toMatch(
      /can't take over/,
    );
    expect(h.respawn).not.toHaveBeenCalled();
  });

  it("refuses once the stall is over", async () => {
    addAgent();
    h.stalled = false;

    await expect(handoffAgentToAccount("a1", "work")).rejects.toMatch(
      /usage limit/,
    );
    expect(h.respawn).not.toHaveBeenCalled();
  });

  it("refuses while the agent is working instead of queueing", async () => {
    addAgent({ status: "running" });

    await expect(handoffAgentToAccount("a1", "work")).rejects.toMatch(
      /still working/,
    );
    expect(appState.sessions.get("s1")!.claude_account_id).toBe("personal");
  });

  it("sends nothing when the agent couldn't move", async () => {
    addAgent();
    h.respawn.mockRejectedValue("spawn failed");

    await expect(handoffAgentToAccount("a1", "work")).rejects.toBe(
      "spawn failed",
    );
    expect(h.send).not.toHaveBeenCalled();
    expect(appState.sessions.get("s1")!.claude_account_id).toBe("personal");
  });
});
