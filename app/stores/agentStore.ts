import type { AgentStatus } from "../lib/types";
import { create } from "zustand";

interface AgentStoreData {
  // Which agent is active per workspace: workspace_id -> agent_id
  activeAgentId: Record<string, string | null>;
  // All agents, keyed by agent_id
  agents: Record<string, AgentStatus>;
}

const agentStore = create<AgentStoreData>(() => ({
  agents: {},
  activeAgentId: {},
}));

const useAgentStore = agentStore;

export const addAgent = (agent: AgentStatus) => {
  agentStore.setState((state) => ({
    agents: { ...state.agents, [agent.agent_id]: agent },
    activeAgentId: {
      ...state.activeAgentId,
      [agent.workspace_id]: agent.agent_id,
    },
  }));
};

export const updateAgent = (agentId: string, patch: Partial<AgentStatus>) => {
  agentStore.setState((state) => {
    const existing = state.agents[agentId];
    if (!existing) {
      return state;
    }

    return {
      agents: {
        ...state.agents,
        [agentId]: { ...existing, ...patch },
      },
    };
  });
};

export const removeAgent = (agentId: string) => {
  agentStore.setState((state) => {
    const agent = state.agents[agentId];
    if (!agent) {
      return state;
    }
    const { [agentId]: _removed, ...next } = state.agents;
    const activeUpdate = { ...state.activeAgentId };
    if (activeUpdate[agent.workspace_id] === agentId) {
      const remaining = Object.values(next).filter(
        (a) => a.workspace_id === agent.workspace_id,
      );
      activeUpdate[agent.workspace_id] =
        remaining.length > 0 ? remaining[0].agent_id : null;
    }

    return { agents: next, activeAgentId: activeUpdate };
  });
};

export const replaceAgent = (oldAgentId: string, newAgent: AgentStatus) => {
  agentStore.setState((state) => {
    const { [oldAgentId]: _old, ...rest } = state.agents;
    const next = { ...rest, [newAgent.agent_id]: newAgent };
    const activeUpdate = { ...state.activeAgentId };
    if (activeUpdate[newAgent.workspace_id] === oldAgentId) {
      activeUpdate[newAgent.workspace_id] = newAgent.agent_id;
    }

    return { agents: next, activeAgentId: activeUpdate };
  });
};

export const getAgent = (agentId: string): AgentStatus | undefined =>
  agentStore.getState().agents[agentId];

export const getAgentsByWorkspace = (workspaceId: string): AgentStatus[] =>
  Object.values(agentStore.getState().agents).filter(
    (a) => a.workspace_id === workspaceId,
  );

export const setActiveAgent = (workspaceId: string, agentId: string | null) => {
  agentStore.setState((state) => ({
    activeAgentId: { ...state.activeAgentId, [workspaceId]: agentId },
  }));
};

export const getActiveAgent = (workspaceId: string): AgentStatus | null => {
  const state = agentStore.getState();
  const id = state.activeAgentId[workspaceId];
  if (!id) {
    return null;
  }

  return state.agents[id] ?? null;
};

export const useAgentsRecord = () => useAgentStore((s) => s.agents);

export const useActiveAgentIds = () => useAgentStore((s) => s.activeAgentId);

export const useAgentStatus = (agentId: string) =>
  useAgentStore((s) => s.agents[agentId]);

/** For tests and imperative access */
export const getAgentState = () => agentStore.getState();
export const setAgentState = agentStore.setState.bind(agentStore);
