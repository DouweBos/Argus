import type { AgentStatus } from "../lib/types";
import { beforeEach, describe, expect, it } from "vitest";
import {
  addAgent,
  getActiveAgent,
  getAgentsByWorkspace,
  getAgentState,
  removeAgent,
  replaceAgent,
  setAgentState,
  updateAgent,
} from "./agentStore";

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
    setAgentState({ agents: {}, activeAgentId: {} });
  });

  it("adds an agent and sets it as active", () => {
    addAgent(agent());
    const state = getAgentState();
    expect(state.agents["agent-1"]).toBeDefined();
    expect(state.activeAgentId["ws-1"]).toBe("agent-1");
  });

  it("updates an existing agent", () => {
    addAgent(agent());
    updateAgent("agent-1", { status: "running" });
    expect(getAgentState().agents["agent-1"].status).toBe("running");
  });

  it("ignores updates for unknown agents", () => {
    const before = getAgentState();
    updateAgent("nope", { status: "running" });
    expect(getAgentState().agents).toEqual(before.agents);
  });

  it("removes an agent and clears active if it was active", () => {
    addAgent(agent());
    removeAgent("agent-1");
    expect(getAgentState().agents["agent-1"]).toBeUndefined();
    expect(getAgentState().activeAgentId["ws-1"]).toBeNull();
  });

  it("replaces an agent ID preserving the active slot", () => {
    addAgent(agent());
    replaceAgent(
      "agent-1",
      agent({ agent_id: "agent-2", workspace_id: "ws-1" }),
    );
    expect(getAgentState().agents["agent-1"]).toBeUndefined();
    expect(getAgentState().agents["agent-2"]).toBeDefined();
    expect(getAgentState().activeAgentId["ws-1"]).toBe("agent-2");
  });

  it("getActiveAgent returns null when no agent set", () => {
    expect(getActiveAgent("ws-1")).toBeNull();
  });

  it("getActiveAgent returns the active agent", () => {
    addAgent(agent());
    const active = getActiveAgent("ws-1");
    expect(active?.agent_id).toBe("agent-1");
  });

  it("getAgentsByWorkspace filters correctly", () => {
    addAgent(agent());
    addAgent(agent({ agent_id: "agent-2", workspace_id: "ws-2" }));
    const ws1 = getAgentsByWorkspace("ws-1");
    expect(ws1).toHaveLength(1);
    expect(ws1[0].agent_id).toBe("agent-1");
  });
});
