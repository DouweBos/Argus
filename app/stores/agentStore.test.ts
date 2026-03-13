import { describe, expect, it, beforeEach } from "vitest";
import { useAgentStore } from "./agentStore";
import type { AgentStatus } from "../lib/types";

function agent(overrides: Partial<AgentStatus> = {}): AgentStatus {
  return {
    agent_id: "agent-1",
    workspace_id: "ws-1",
    status: "idle",
    ...overrides,
  };
}

describe("agentStore", () => {
  beforeEach(() => {
    useAgentStore.setState({ agents: {}, activeAgentId: {} });
  });

  it("adds an agent and sets it as active", () => {
    useAgentStore.getState().addAgent(agent());
    const state = useAgentStore.getState();
    expect(state.agents["agent-1"]).toBeDefined();
    expect(state.activeAgentId["ws-1"]).toBe("agent-1");
  });

  it("updates an existing agent", () => {
    useAgentStore.getState().addAgent(agent());
    useAgentStore.getState().updateAgent("agent-1", { status: "running" });
    expect(useAgentStore.getState().agents["agent-1"].status).toBe("running");
  });

  it("ignores updates for unknown agents", () => {
    const before = useAgentStore.getState();
    useAgentStore.getState().updateAgent("nope", { status: "running" });
    expect(useAgentStore.getState().agents).toEqual(before.agents);
  });

  it("removes an agent and clears active if it was active", () => {
    useAgentStore.getState().addAgent(agent());
    useAgentStore.getState().removeAgent("agent-1");
    expect(useAgentStore.getState().agents["agent-1"]).toBeUndefined();
    expect(useAgentStore.getState().activeAgentId["ws-1"]).toBeNull();
  });

  it("replaces an agent ID preserving the active slot", () => {
    useAgentStore.getState().addAgent(agent());
    useAgentStore
      .getState()
      .replaceAgent(
        "agent-1",
        agent({ agent_id: "agent-2", workspace_id: "ws-1" }),
      );
    expect(useAgentStore.getState().agents["agent-1"]).toBeUndefined();
    expect(useAgentStore.getState().agents["agent-2"]).toBeDefined();
    expect(useAgentStore.getState().activeAgentId["ws-1"]).toBe("agent-2");
  });

  it("getActiveAgent returns null when no agent set", () => {
    expect(useAgentStore.getState().getActiveAgent("ws-1")).toBeNull();
  });

  it("getActiveAgent returns the active agent", () => {
    useAgentStore.getState().addAgent(agent());
    const active = useAgentStore.getState().getActiveAgent("ws-1");
    expect(active?.agent_id).toBe("agent-1");
  });

  it("getAgentsByWorkspace filters correctly", () => {
    useAgentStore.getState().addAgent(agent());
    useAgentStore
      .getState()
      .addAgent(agent({ agent_id: "agent-2", workspace_id: "ws-2" }));
    const ws1 = useAgentStore.getState().getAgentsByWorkspace("ws-1");
    expect(ws1).toHaveLength(1);
    expect(ws1[0].agent_id).toBe("agent-1");
  });
});
