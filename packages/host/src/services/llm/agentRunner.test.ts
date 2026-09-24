import type { LlmRunner } from "./runners/types";
import type { AgentSession } from "../agent/models";
import { beforeEach, describe, expect, it, vi } from "vitest";

const respawnAgent = vi.fn(async (_id: string) => {});

vi.mock("../agent/agentService", () => ({
  respawnAgent: (id: string) => respawnAgent(id),
}));
vi.mock("@argus/host/bus", () => ({ emitHostEvent: () => {} }));

const { appState } = await import("../../state");
const { registerRunner } = await import("./registry");
const { setAgentRunner } = await import("./agentRunner");

function fakeRunner(id: string, defaultModel: string | null): LlmRunner {
  return {
    id,
    displayName: id,
    isCustom: true,
    capabilities: () => ({
      supportsMcp: true,
      supportsTranscriptFork: true,
      supportsSetModel: true,
      supportsSetPermissionMode: true,
      supportsSetEffort: true,
      supportsInterrupt: true,
    }),
    defaultModel: () => defaultModel,
    preflight: async () => ({ ok: true, binPath: "/usr/bin/fake" }),
    spawn: async () => ({}) as never,
    oneShot: async () => null,
  };
}

const base = fakeRunner("claude-code", "claude-opus-5");

function addAgent(agentId: string, over: Partial<AgentSession> = {}): void {
  appState.agents.set(agentId, {
    agentId,
    sessionId: "s1",
    runner: base,
    model: "claude-opus-5",
    turnsCompleted: 0,
    inflightPrompts: 0,
    prewarmed: false,
    ...over,
  } as AgentSession);
}

describe("setAgentRunner", () => {
  beforeEach(() => {
    appState.agents.clear();
    respawnAgent.mockClear();
    registerRunner(fakeRunner("custom:apex", "callstack/Apex"));
  });

  it("re-binds the agent, resets its model and restarts it", async () => {
    addAgent("a1");

    await setAgentRunner("a1", "custom:apex");

    const agent = appState.agents.get("a1")!;
    expect(agent.runner.id).toBe("custom:apex");
    expect(agent.model).toBe("callstack/Apex");
    expect(respawnAgent).toHaveBeenCalledWith("a1");
  });

  it("leaves sibling agents on their own runner", async () => {
    addAgent("a1");
    addAgent("a2");

    await setAgentRunner("a1", "custom:apex");

    expect(appState.agents.get("a2")!.runner.id).toBe("claude-code");
  });

  it("refuses once that agent has started working", async () => {
    addAgent("a1", { turnsCompleted: 1 });

    await expect(setAgentRunner("a1", "custom:apex")).rejects.toContain(
      "fixed once the agent has started working",
    );
    expect(appState.agents.get("a1")!.runner.id).toBe("claude-code");
  });

  it("refuses while a prompt is still in flight", async () => {
    addAgent("a1", { inflightPrompts: 1 });

    await expect(setAgentRunner("a1", "custom:apex")).rejects.toContain(
      "fixed once the agent has started working",
    );
  });

  it("rejects an unregistered runner", async () => {
    addAgent("a1");

    await expect(setAgentRunner("a1", "custom:nope")).rejects.toContain(
      "Unknown runner",
    );
  });
});
