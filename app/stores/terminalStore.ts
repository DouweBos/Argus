import type { TerminalSession } from "../lib/types";
import { create } from "zustand";

interface TerminalStoreData {
  // Map of workspaceId -> active session id
  activeSessionId: Record<string, string | null>;
  /** Serialized xterm buffer cache for unmounted terminals. */
  bufferCache: Record<string, string>;
  // Map of workspaceId -> whether the run command is executing
  runBusy: Record<string, boolean>;
  // Map of workspaceId -> run terminal session id
  runSessionId: Record<string, string | null>;
  // Map of workspaceId -> list of sessions
  sessions: Record<string, TerminalSession[]>;
}

const terminalStore = create<TerminalStoreData>(() => ({
  sessions: {},
  activeSessionId: {},
  runSessionId: {},
  runBusy: {},
  bufferCache: {},
}));

const useTerminalStore = terminalStore;

export const addSession = (session: TerminalSession) => {
  terminalStore.setState((state) => {
    const existing = state.sessions[session.workspace_id] ?? [];

    return {
      sessions: {
        ...state.sessions,
        [session.workspace_id]: [...existing, session],
      },
      activeSessionId: {
        ...state.activeSessionId,
        [session.workspace_id]: session.id,
      },
    };
  });
};

export const removeSession = (workspaceId: string, sessionId: string) => {
  terminalStore.setState((state) => {
    const existing = state.sessions[workspaceId] ?? [];
    const remaining = existing.filter((s) => s.id !== sessionId);
    const currentActive = state.activeSessionId[workspaceId];
    const newActive =
      currentActive === sessionId
        ? (remaining[remaining.length - 1]?.id ?? null)
        : currentActive;

    return {
      sessions: { ...state.sessions, [workspaceId]: remaining },
      activeSessionId: {
        ...state.activeSessionId,
        [workspaceId]: newActive,
      },
    };
  });
};

export const setActiveSession = (
  workspaceId: string,
  sessionId: string | null,
) => {
  terminalStore.setState((state) => ({
    activeSessionId: {
      ...state.activeSessionId,
      [workspaceId]: sessionId,
    },
  }));
};

export const getSessionsForWorkspace = (
  workspaceId: string,
): TerminalSession[] => terminalStore.getState().sessions[workspaceId] ?? [];

export const getActiveSessionId = (workspaceId: string): string | null =>
  terminalStore.getState().activeSessionId[workspaceId] ?? null;

export const updateSession = (
  sessionId: string,
  patch: Partial<TerminalSession>,
) => {
  terminalStore.setState((state) => {
    const updatedSessions: Record<string, TerminalSession[]> = {};
    for (const [wid, list] of Object.entries(state.sessions)) {
      updatedSessions[wid] = list.map((s) =>
        s.id === sessionId ? { ...s, ...patch } : s,
      );
    }

    return { sessions: updatedSessions };
  });
};

export const setRunSession = (
  workspaceId: string,
  sessionId: string | null,
) => {
  terminalStore.setState((state) => ({
    runSessionId: { ...state.runSessionId, [workspaceId]: sessionId },
  }));
};

export const setRunBusy = (workspaceId: string, busy: boolean) => {
  terminalStore.setState((state) => ({
    runBusy: { ...state.runBusy, [workspaceId]: busy },
  }));
};

export const getRunSessionId = (workspaceId: string): string | null =>
  terminalStore.getState().runSessionId[workspaceId] ?? null;

export const isRunBusy = (workspaceId: string): boolean =>
  terminalStore.getState().runBusy[workspaceId] ?? false;

export const cacheBuffer = (sessionId: string, data: string) => {
  terminalStore.setState((state) => ({
    bufferCache: { ...state.bufferCache, [sessionId]: data },
  }));
};

export const getBuffer = (sessionId: string): string | null =>
  terminalStore.getState().bufferCache[sessionId] ?? null;

export const clearBuffer = (sessionId: string) => {
  terminalStore.setState((state) => {
    const next = { ...state.bufferCache };
    delete next[sessionId];

    return { bufferCache: next };
  });
};

export const migrateSessions = (fromId: string, toId: string) => {
  terminalStore.setState((state) => {
    if (fromId === toId) {
      return state;
    }
    const sessionsToMove = state.sessions[fromId] ?? [];
    if (sessionsToMove.length === 0) {
      return state;
    }
    const existing = state.sessions[toId] ?? [];
    const newSessions = { ...state.sessions };
    delete newSessions[fromId];
    newSessions[toId] = [
      ...existing,
      ...sessionsToMove.map((s) => ({ ...s, workspace_id: toId })),
    ];
    const fromActive = state.activeSessionId[fromId];
    const toActive = state.activeSessionId[toId];
    const newActiveSessionId = { ...state.activeSessionId };
    delete newActiveSessionId[fromId];
    newActiveSessionId[toId] = toActive ?? fromActive ?? null;

    return {
      sessions: newSessions,
      activeSessionId: newActiveSessionId,
    };
  });
};

const EMPTY_SESSIONS: TerminalSession[] = [];

export const useTerminalSessionsSlice = (workspaceId: string) =>
  useTerminalStore((s) => s.sessions[workspaceId] ?? EMPTY_SESSIONS);

export const useActiveSessionId = (workspaceId: string) =>
  useTerminalStore((s) => s.activeSessionId[workspaceId] ?? null);

export const useRunSessionId = (workspaceId: string) =>
  useTerminalStore((s) => s.runSessionId[workspaceId] ?? null);

export const useRunBusy = (workspaceId: string) =>
  useTerminalStore((s) => s.runBusy[workspaceId] ?? false);

/** For tests */
export const getTerminalState = () => terminalStore.getState();
export const setTerminalState = terminalStore.setState.bind(terminalStore);
