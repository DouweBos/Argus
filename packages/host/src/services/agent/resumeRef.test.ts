import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../claudeAuth/accounts", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  resolveAccountForSession: (s?: { claude_account_id?: string | null }) =>
    s?.claude_account_id ?? "personal",
  envForAccount: () => ({ ...process.env }),
  getClaudeAccount: () => undefined,
}));
vi.mock("../session/sessionOps", () => ({
  setSessionClaudeAccount: (id: string, accountId: string | null) => {
    appState.sessions.get(id)!.claude_account_id = accountId;
  },
}));
vi.mock("../telemetry/telemetry", () => ({ capture: vi.fn() }));
vi.mock("./spawnStamp", () => ({ spawnConfigStamp: async () => "stamp" }));

// First: agentService reaches accountSwitch through a cycle.
const { switchSessionClaudeAccount } = await import("./accountSwitch");
const { appState } = await import("../../state");
const { startAgent } = await import("./agentService");
const { setAgentRunner } = await import("../llm/agentRunner");
const { registerRunner, getRunnerById } = await import("../llm/registry");
const { getPin, removePin } = await import("./pins/store");
const { setAgentPinned } = await import("./pins/pins");
const { fakeClaude } = await import("./agentService.testkit");

let fake: ReturnType<typeof fakeClaude>;

async function resumed(): Promise<string> {
  const info = await startAgent("s1", undefined, undefined, "conversation-1");

  return info.agent_id;
}

describe("a resumed chat before its first new turn", () => {
  beforeEach(() => {
    fake = fakeClaude();
  });

  afterEach(() => {
    for (const id of appState.agents.keys()) {
      removePin(id);
    }
    appState.agents.clear();
    appState.sessions.clear();
  });

  it("keeps its history on another account", async () => {
    const id = await resumed();

    await switchSessionClaudeAccount("s1", "work", id);

    expect(fake.spawns).toHaveLength(2);
    expect(fake.spawns[1]!.args.resumeRef).toBe("conversation-1");
  });

  it("can't change runner, which would drop that history", async () => {
    const id = await resumed();
    registerRunner({ ...getRunnerById("claude-code")!, id: "custom:other" });

    await expect(setAgentRunner(id, "custom:other")).rejects.toContain(
      "fixed once the agent has started working",
    );
  });

  it("pins the conversation it resumed", async () => {
    const id = await resumed();

    setAgentPinned(id, true, "ipc");

    expect(getPin(id)?.runnerSessionId).toBe("conversation-1");
  });
});
