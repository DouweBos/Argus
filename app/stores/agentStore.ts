import type { AgentStatus } from "../lib/types";
import { create } from "zustand";

export interface SplitPair {
  left: string;
  right: string;
}

export interface RecentlyClosedAgent {
  agentId: string;
  claudeSessionId?: string;
  closedAt: number;
  title: string;
}

const RECENTLY_CLOSED_LIMIT = 5;

interface AgentStoreData {
  // Which agent is active per session: session_id -> agent_id
  activeAgentId: Record<string, string | null>;
  // All agents, keyed by agent_id
  agents: Record<string, AgentStatus>;
  // Ordered agent ids per session (tab order)
  order: Record<string, string[]>;
  // Agents that are currently detached into their own popout window. These
  // are hidden from the tab bar while detached; closing the popout window (or
  // pressing "back to main window") removes them from this set.
  poppedOut: Record<string, true>;
  // Most recently closed agents per session, newest first, capped at 5.
  recentlyClosed: Record<string, RecentlyClosedAgent[]>;
  // A paired (merged) tab per session. When the active agent is one of the
  // pair members, the UI renders a split view; otherwise it renders a single
  // agent. Only one pair per session — dropping a third agent on the right
  // replaces the previous pairing.
  splitPair: Record<string, SplitPair | null>;
}

const agentStore = create<AgentStoreData>(() => ({
  agents: {},
  activeAgentId: {},
  order: {},
  poppedOut: {},
  recentlyClosed: {},
  splitPair: {},
}));

function appendOrder(
  order: Record<string, string[]>,
  sessionId: string,
  agentId: string,
): Record<string, string[]> {
  const existing = order[sessionId] ?? [];
  if (existing.includes(agentId)) {
    return order;
  }

  return { ...order, [sessionId]: [...existing, agentId] };
}

function removeFromOrder(
  order: Record<string, string[]>,
  sessionId: string,
  agentId: string,
): Record<string, string[]> {
  const existing = order[sessionId];
  if (!existing) {
    return order;
  }
  const next = existing.filter((id) => id !== agentId);
  if (next.length === existing.length) {
    return order;
  }

  return { ...order, [sessionId]: next };
}

function replaceInOrder(
  order: Record<string, string[]>,
  sessionId: string,
  oldId: string,
  newId: string,
): Record<string, string[]> {
  const existing = order[sessionId];
  if (!existing) {
    return { ...order, [sessionId]: [newId] };
  }
  const idx = existing.indexOf(oldId);
  if (idx === -1) {
    return { ...order, [sessionId]: [...existing, newId] };
  }
  const next = existing.slice();
  next[idx] = newId;

  return { ...order, [sessionId]: next };
}

const useAgentStore = agentStore;

export const addAgent = (agent: AgentStatus) => {
  agentStore.setState((state) => ({
    agents: { ...state.agents, [agent.agent_id]: agent },
    activeAgentId: {
      ...state.activeAgentId,
      [agent.session_id]: agent.agent_id,
    },
    order: appendOrder(state.order, agent.session_id, agent.agent_id),
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
    const splitPairUpdate = { ...state.splitPair };
    const existingPair = splitPairUpdate[agent.session_id];
    if (
      existingPair &&
      (existingPair.left === agentId || existingPair.right === agentId)
    ) {
      splitPairUpdate[agent.session_id] = null;
    }
    const orderUpdate = removeFromOrder(state.order, agent.session_id, agentId);
    if (activeUpdate[agent.session_id] === agentId) {
      const previousOrder = state.order[agent.session_id] ?? [];
      const removedIdx = previousOrder.indexOf(agentId);
      const nextOrder = orderUpdate[agent.session_id] ?? [];
      let neighborId: string | null = null;
      if (nextOrder.length > 0) {
        const neighborIdx = removedIdx > 0 ? removedIdx - 1 : 0;
        neighborId = nextOrder[Math.min(neighborIdx, nextOrder.length - 1)];
      }
      activeUpdate[agent.session_id] = neighborId;
    }

    return {
      agents: next,
      activeAgentId: activeUpdate,
      splitPair: splitPairUpdate,
      order: orderUpdate,
    };
  });
};

export const replaceAgent = (oldAgentId: string, newAgent: AgentStatus) => {
  agentStore.setState((state) => {
    const { [oldAgentId]: _old, ...rest } = state.agents;
    const next = { ...rest, [newAgent.agent_id]: newAgent };
    const activeUpdate = { ...state.activeAgentId };
    if (activeUpdate[newAgent.session_id] === oldAgentId) {
      activeUpdate[newAgent.session_id] = newAgent.agent_id;
    }
    const orderUpdate = replaceInOrder(
      state.order,
      newAgent.session_id,
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
 * Reorder an agent tab within a session. Moves `agentId` so that it occupies
 * the slot currently held by `targetAgentId`. `position` decides whether the
 * agent lands immediately before or after the target when dropping.
 */
export const reorderAgent = (
  sessionId: string,
  agentId: string,
  targetAgentId: string,
  position: "after" | "before" = "before",
): void => {
  if (agentId === targetAgentId) {
    return;
  }
  agentStore.setState((state) => {
    const current = state.order[sessionId];
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

    return { order: { ...state.order, [sessionId]: without } };
  });
};

export const getAgent = (agentId: string): AgentStatus | undefined =>
  agentStore.getState().agents[agentId];

export const getAgentsBySession = (sessionId: string): AgentStatus[] =>
  Object.values(agentStore.getState().agents).filter(
    (a) => a.session_id === sessionId,
  );

export const setActiveAgent = (sessionId: string, agentId: string | null) => {
  agentStore.setState((state) => ({
    activeAgentId: { ...state.activeAgentId, [sessionId]: agentId },
  }));
};

/**
 * Rotate the active agent tab for a session. `direction` is +1 for next,
 * -1 for previous; wraps around. No-op if there are 0 or 1 agents.
 */
export const cycleActiveAgent = (
  sessionId: string,
  direction: -1 | 1,
): void => {
  const state = agentStore.getState();
  const ids = Object.values(state.agents)
    .filter((a) => a.session_id === sessionId)
    .map((a) => a.agent_id);
  if (ids.length < 2) {
    return;
  }
  const currentId = state.activeAgentId[sessionId];
  const currentIdx = currentId ? ids.indexOf(currentId) : -1;
  const base = currentIdx === -1 ? 0 : currentIdx;
  const nextIdx = (base + direction + ids.length) % ids.length;
  const nextId = ids[nextIdx];
  if (nextId) {
    agentStore.setState((s) => ({
      activeAgentId: { ...s.activeAgentId, [sessionId]: nextId },
    }));
  }
};

export const getActiveAgent = (sessionId: string): AgentStatus | null => {
  const state = agentStore.getState();
  const id = state.activeAgentId[sessionId];
  if (!id) {
    return null;
  }

  return state.agents[id] ?? null;
};

export const useAgentsRecord = () => useAgentStore((s) => s.agents);

export const useActiveAgentIds = () => useAgentStore((s) => s.activeAgentId);

export const useAgentOrder = (sessionId: string | null) =>
  useAgentStore((s) =>
    sessionId ? (s.order[sessionId] ?? EMPTY_ORDER) : EMPTY_ORDER,
  );

const EMPTY_ORDER: string[] = [];

export const useAgentStatus = (agentId: string) =>
  useAgentStore((s) => s.agents[agentId]);

export const setSplitPair = (sessionId: string, pair: SplitPair | null) => {
  agentStore.setState((state) => ({
    splitPair: { ...state.splitPair, [sessionId]: pair },
  }));
};

export const useSplitPair = (sessionId: string | null): SplitPair | null =>
  useAgentStore((s) => (sessionId ? (s.splitPair[sessionId] ?? null) : null));

export const recordRecentlyClosed = (
  sessionId: string,
  entry: RecentlyClosedAgent,
) => {
  agentStore.setState((state) => {
    const existing = state.recentlyClosed[sessionId] ?? [];
    const next = [
      entry,
      ...existing.filter((e) => e.agentId !== entry.agentId),
    ].slice(0, RECENTLY_CLOSED_LIMIT);

    return {
      recentlyClosed: { ...state.recentlyClosed, [sessionId]: next },
    };
  });
};

export const removeRecentlyClosed = (sessionId: string, agentId: string) => {
  agentStore.setState((state) => {
    const existing = state.recentlyClosed[sessionId];
    if (!existing) {
      return state;
    }
    const next = existing.filter((e) => e.agentId !== agentId);
    if (next.length === existing.length) {
      return state;
    }

    return {
      recentlyClosed: { ...state.recentlyClosed, [sessionId]: next },
    };
  });
};

const EMPTY_RECENT: RecentlyClosedAgent[] = [];

export const useRecentlyClosedAgents = (
  sessionId: string | null,
): RecentlyClosedAgent[] =>
  useAgentStore((s) =>
    sessionId ? (s.recentlyClosed[sessionId] ?? EMPTY_RECENT) : EMPTY_RECENT,
  );

export const markAgentPoppedOut = (agentId: string) => {
  agentStore.setState((state) =>
    state.poppedOut[agentId]
      ? state
      : { poppedOut: { ...state.poppedOut, [agentId]: true } },
  );
};

export const unmarkAgentPoppedOut = (agentId: string) => {
  agentStore.setState((state) => {
    if (!state.poppedOut[agentId]) {
      return state;
    }
    const { [agentId]: _removed, ...rest } = state.poppedOut;

    return { poppedOut: rest };
  });
};

export const seedPoppedOutAgents = (agentIds: string[]) => {
  agentStore.setState(() => {
    const next: Record<string, true> = {};
    for (const id of agentIds) {
      next[id] = true;
    }

    return { poppedOut: next };
  });
};

export const isAgentPoppedOut = (agentId: string): boolean =>
  !!agentStore.getState().poppedOut[agentId];

export const usePoppedOutAgents = () => useAgentStore((s) => s.poppedOut);

/** For tests and imperative access */
export const getAgentState = () => agentStore.getState();
export const setAgentState = agentStore.setState.bind(agentStore);
