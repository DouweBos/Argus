import { create } from "zustand";
import type { AgentStatus } from "../lib/types";

interface AgentState {
  // Which agent is active per workspace: workspace_id -> agent_id
  activeAgentId: Record<string, null | string>;
  addAgent: (agent: AgentStatus) => void;

  // All agents, keyed by agent_id
  agents: Record<string, AgentStatus>;
  getActiveAgent: (workspaceId: string) => AgentStatus | null;
  getAgent: (agentId: string) => AgentStatus | undefined;
  getAgentsByWorkspace: (workspaceId: string) => AgentStatus[];
  removeAgent: (agentId: string) => void;
  /** Swap an old agent ID for a new agent, keeping the same tab slot. */
  replaceAgent: (oldAgentId: string, newAgent: AgentStatus) => void;
  setActiveAgent: (workspaceId: string, agentId: null | string) => void;
  updateAgent: (agentId: string, patch: Partial<AgentStatus>) => void;
}

export const useAgentStore = create<AgentState>((set, get) => ({
  agents: {},
  activeAgentId: {},

  addAgent: (agent) =>
    set((state) => ({
      agents: { ...state.agents, [agent.agent_id]: agent },
      activeAgentId: {
        ...state.activeAgentId,
        [agent.workspace_id]: agent.agent_id,
      },
    })),

  updateAgent: (agentId, patch) =>
    set((state) => {
      const existing = state.agents[agentId];
      if (!existing) return state;
      return {
        agents: {
          ...state.agents,
          [agentId]: { ...existing, ...patch },
        },
      };
    }),

  removeAgent: (agentId) =>
    set((state) => {
      const agent = state.agents[agentId];
      if (!agent) return state;
      const next = { ...state.agents };
      delete next[agentId];
      // If this was the active agent, pick another or null
      const activeUpdate = { ...state.activeAgentId };
      if (activeUpdate[agent.workspace_id] === agentId) {
        const remaining = Object.values(next).filter(
          (a) => a.workspace_id === agent.workspace_id,
        );
        activeUpdate[agent.workspace_id] =
          remaining.length > 0 ? remaining[0].agent_id : null;
      }
      return { agents: next, activeAgentId: activeUpdate };
    }),

  replaceAgent: (oldAgentId, newAgent) =>
    set((state) => {
      const next = { ...state.agents };
      delete next[oldAgentId];
      next[newAgent.agent_id] = newAgent;
      const activeUpdate = { ...state.activeAgentId };
      if (activeUpdate[newAgent.workspace_id] === oldAgentId) {
        activeUpdate[newAgent.workspace_id] = newAgent.agent_id;
      }
      return { agents: next, activeAgentId: activeUpdate };
    }),

  getAgent: (agentId) => get().agents[agentId],

  getAgentsByWorkspace: (workspaceId) =>
    Object.values(get().agents).filter((a) => a.workspace_id === workspaceId),

  setActiveAgent: (workspaceId, agentId) =>
    set((state) => ({
      activeAgentId: { ...state.activeAgentId, [workspaceId]: agentId },
    })),

  getActiveAgent: (workspaceId) => {
    const state = get();
    const agentId = state.activeAgentId[workspaceId];
    if (!agentId) return null;
    return state.agents[agentId] ?? null;
  },
}));
