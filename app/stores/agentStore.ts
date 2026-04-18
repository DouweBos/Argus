import type { AgentStatus } from "../lib/types";
import { create } from "zustand";

interface AgentStoreData {
  // Which agent is active per workspace: workspace_id -> agent_id
  activeAgentId: Record<string, string | null>;
  // All agents, keyed by agent_id
  agents: Record<string, AgentStatus>;
  // Ordered agent ids per workspace (tab order)
  order: Record<string, string[]>;
}

const agentStore = create<AgentStoreData>(() => ({
  agents: {},
  activeAgentId: {},
  order: {},
}));

function appendOrder(
  order: Record<string, string[]>,
  workspaceId: string,
  agentId: string,
): Record<string, string[]> {
  const existing = order[workspaceId] ?? [];
  if (existing.includes(agentId)) {
    return order;
  }

  return { ...order, [workspaceId]: [...existing, agentId] };
}

function removeFromOrder(
  order: Record<string, string[]>,
  workspaceId: string,
  agentId: string,
): Record<string, string[]> {
  const existing = order[workspaceId];
  if (!existing) {
    return order;
  }
  const next = existing.filter((id) => id !== agentId);
  if (next.length === existing.length) {
    return order;
  }

  return { ...order, [workspaceId]: next };
}

function replaceInOrder(
  order: Record<string, string[]>,
  workspaceId: string,
  oldId: string,
  newId: string,
): Record<string, string[]> {
  const existing = order[workspaceId];
  if (!existing) {
    return { ...order, [workspaceId]: [newId] };
  }
  const idx = existing.indexOf(oldId);
  if (idx === -1) {
    return { ...order, [workspaceId]: [...existing, newId] };
  }
  const next = existing.slice();
  next[idx] = newId;

  return { ...order, [workspaceId]: next };
}

const useAgentStore = agentStore;

export const addAgent = (agent: AgentStatus) => {
  agentStore.setState((state) => ({
    agents: { ...state.agents, [agent.agent_id]: agent },
    activeAgentId: {
      ...state.activeAgentId,
      [agent.workspace_id]: agent.agent_id,
    },
    order: appendOrder(state.order, agent.workspace_id, agent.agent_id),
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
    const orderUpdate = removeFromOrder(
      state.order,
      agent.workspace_id,
      agentId,
    );

    return {
      agents: next,
      activeAgentId: activeUpdate,
      order: orderUpdate,
    };
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
    const orderUpdate = replaceInOrder(
      state.order,
      newAgent.workspace_id,
      oldAgentId,
      newAgent.agent_id,
    );

    return {
      agents: next,
      activeAgentId: activeUpdate,
      order: orderUpdate,
    };
  });
};

/**
 * Reorder an agent tab within a workspace. Moves `agentId` so that it occupies
 * the slot currently held by `targetAgentId`. `position` decides whether the
 * agent lands immediately before or after the target when dropping.
 */
export const reorderAgent = (
  workspaceId: string,
  agentId: string,
  targetAgentId: string,
  position: "after" | "before" = "before",
): void => {
  if (agentId === targetAgentId) {
    return;
  }
  agentStore.setState((state) => {
    const current = state.order[workspaceId];
    if (!current) {
      return state;
    }
    const fromIdx = current.indexOf(agentId);
    const toIdx = current.indexOf(targetAgentId);
    if (fromIdx === -1 || toIdx === -1) {
      return state;
    }
    const without = current.slice();
    without.splice(fromIdx, 1);
    const adjustedTargetIdx = without.indexOf(targetAgentId);
    const insertIdx =
      position === "after" ? adjustedTargetIdx + 1 : adjustedTargetIdx;
    without.splice(insertIdx, 0, agentId);

    return { order: { ...state.order, [workspaceId]: without } };
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

/**
 * Rotate the active agent tab for a workspace. `direction` is +1 for next,
 * -1 for previous; wraps around. No-op if there are 0 or 1 agents.
 */
export const cycleActiveAgent = (
  workspaceId: string,
  direction: -1 | 1,
): void => {
  const state = agentStore.getState();
  const ids = Object.values(state.agents)
    .filter((a) => a.workspace_id === workspaceId)
    .map((a) => a.agent_id);
  if (ids.length < 2) {
    return;
  }
  const currentId = state.activeAgentId[workspaceId];
  const currentIdx = currentId ? ids.indexOf(currentId) : -1;
  const base = currentIdx === -1 ? 0 : currentIdx;
  const nextIdx = (base + direction + ids.length) % ids.length;
  const nextId = ids[nextIdx];
  if (nextId) {
    agentStore.setState((s) => ({
      activeAgentId: { ...s.activeAgentId, [workspaceId]: nextId },
    }));
  }
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

export const useAgentOrder = (workspaceId: string | null) =>
  useAgentStore((s) =>
    workspaceId ? (s.order[workspaceId] ?? EMPTY_ORDER) : EMPTY_ORDER,
  );

const EMPTY_ORDER: string[] = [];

export const useAgentStatus = (agentId: string) =>
  useAgentStore((s) => s.agents[agentId]);

/** For tests and imperative access */
export const getAgentState = () => agentStore.getState();
export const setAgentState = agentStore.setState.bind(agentStore);
