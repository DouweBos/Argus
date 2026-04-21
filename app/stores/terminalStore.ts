import type { TerminalSession } from "../lib/types";
import { create } from "zustand";

interface TerminalStoreData {
  // Map of sessionId -> active terminal id
  activeSessionId: Record<string, string | null>;
  /** Serialized xterm buffer cache for unmounted terminals. */
  bufferCache: Record<string, string>;
  /** Map of terminalId -> whether the underlying pty is still alive. */
  liveSessions: Record<string, boolean>;
  // Map of sessionId -> whether the run command is executing
  runBusy: Record<string, boolean>;
  // Map of sessionId -> Map of run-command title -> running terminal id.
  // Populated by RunControl so any component (e.g. SessionCard) can tell
  // whether a session currently has a run-command executing.
  runningTerminals: Record<string, Record<string, string>>;
  // Map of sessionId -> run terminal session id
  runSessionId: Record<string, string | null>;
  // Map of sessionId -> list of terminal sessions
  sessions: Record<string, TerminalSession[]>;
}

const terminalStore = create<TerminalStoreData>(() => ({
  sessions: {},
  activeSessionId: {},
  runSessionId: {},
  runBusy: {},
  bufferCache: {},
  liveSessions: {},
  runningTerminals: {},
}));

const useTerminalStore = terminalStore;

export const addSession = (session: TerminalSession) => {
  terminalStore.setState((state) => {
    const existing = state.sessions[session.session_id] ?? [];

    return {
      sessions: {
        ...state.sessions,
        [session.session_id]: [...existing, session],
      },
      activeSessionId: {
        ...state.activeSessionId,
        [session.session_id]: session.id,
      },
      liveSessions: { ...state.liveSessions, [session.id]: true },
    };
  });
};

export const markSessionExited = (terminalId: string) => {
  terminalStore.setState((state) => ({
    liveSessions: { ...state.liveSessions, [terminalId]: false },
  }));
};

export const useSessionAlive = (terminalId: string | null): boolean =>
  useTerminalStore((s) =>
    terminalId ? (s.liveSessions[terminalId] ?? false) : false,
  );

export const removeSession = (sessionId: string, terminalId: string) => {
  terminalStore.setState((state) => {
    const existing = state.sessions[sessionId] ?? [];
    const remaining = existing.filter((s) => s.id !== terminalId);
    const currentActive = state.activeSessionId[sessionId];
    const newActive =
      currentActive === terminalId
        ? (remaining[remaining.length - 1]?.id ?? null)
        : currentActive;
    const { [terminalId]: _removedAlive, ...remainingAlive } =
      state.liveSessions;

    return {
      sessions: { ...state.sessions, [sessionId]: remaining },
      activeSessionId: {
        ...state.activeSessionId,
        [sessionId]: newActive,
      },
      liveSessions: remainingAlive,
    };
  });
};

export const setActiveSession = (
  sessionId: string,
  terminalId: string | null,
) => {
  terminalStore.setState((state) => ({
    activeSessionId: {
      ...state.activeSessionId,
      [sessionId]: terminalId,
    },
  }));
};

export const getSessionsForSession = (sessionId: string): TerminalSession[] =>
  terminalStore.getState().sessions[sessionId] ?? [];

export const getActiveSessionId = (sessionId: string): string | null =>
  terminalStore.getState().activeSessionId[sessionId] ?? null;

export const updateSession = (
  terminalId: string,
  patch: Partial<TerminalSession>,
) => {
  terminalStore.setState((state) => {
    const updatedSessions: Record<string, TerminalSession[]> = {};
    for (const [sid, list] of Object.entries(state.sessions)) {
      updatedSessions[sid] = list.map((s) =>
        s.id === terminalId ? { ...s, ...patch } : s,
      );
    }

    return { sessions: updatedSessions };
  });
};

/**
 * Reorder a terminal tab within its session. Used by drag-and-drop in the
 * terminal tab bar; semantics mirror `reorderAgent` in `agentStore`.
 */
export const reorderSession = (
  sessionId: string,
  terminalId: string,
  targetTerminalId: string,
  position: "after" | "before" = "before",
) => {
  if (terminalId === targetTerminalId) {
    return;
  }
  terminalStore.setState((state) => {
    const current = state.sessions[sessionId];
    if (!current) {
      return state;
    }
    const fromIdx = current.findIndex((s) => s.id === terminalId);
    const toIdx = current.findIndex((s) => s.id === targetTerminalId);
    if (fromIdx === -1 || toIdx === -1) {
      return state;
    }
    const without = current.slice();
    const [moved] = without.splice(fromIdx, 1);
    const adjustedTargetIdx = without.findIndex(
      (s) => s.id === targetTerminalId,
    );
    const insertIdx =
      position === "after" ? adjustedTargetIdx + 1 : adjustedTargetIdx;
    without.splice(insertIdx, 0, moved);

    return { sessions: { ...state.sessions, [sessionId]: without } };
  });
};

/**
 * Swap the backing terminal id of an existing session tab in place. Used
 * when a run command re-spawns: the tab (and its position) is preserved,
 * but it now points at the freshly-spawned pty. Also migrates liveSessions,
 * bufferCache, and activeSessionId references from the old id to the new.
 */
export const replaceSessionId = (
  sessionId: string,
  fromId: string,
  toId: string,
) => {
  terminalStore.setState((state) => {
    if (fromId === toId) {
      return state;
    }
    const list = state.sessions[sessionId] ?? [];
    const updatedList = list.map((s) =>
      s.id === fromId ? { ...s, id: toId } : s,
    );

    const { [fromId]: _oldAlive, ...restAlive } = state.liveSessions;
    const liveSessions = { ...restAlive, [toId]: true };

    const { [fromId]: oldBuffer, ...restBuffer } = state.bufferCache;
    const bufferCache =
      oldBuffer === undefined
        ? restBuffer
        : { ...restBuffer, [toId]: oldBuffer };

    const activeSessionId =
      state.activeSessionId[sessionId] === fromId
        ? { ...state.activeSessionId, [sessionId]: toId }
        : state.activeSessionId;

    return {
      sessions: { ...state.sessions, [sessionId]: updatedList },
      liveSessions,
      bufferCache,
      activeSessionId,
    };
  });
};

export const setRunSession = (sessionId: string, terminalId: string | null) => {
  terminalStore.setState((state) => ({
    runSessionId: { ...state.runSessionId, [sessionId]: terminalId },
  }));
};

export const setRunBusy = (sessionId: string, busy: boolean) => {
  terminalStore.setState((state) => ({
    runBusy: { ...state.runBusy, [sessionId]: busy },
  }));
};

export const getRunSessionId = (sessionId: string): string | null =>
  terminalStore.getState().runSessionId[sessionId] ?? null;

export const isRunBusy = (sessionId: string): boolean =>
  terminalStore.getState().runBusy[sessionId] ?? false;

export const cacheBuffer = (terminalId: string, data: string) => {
  terminalStore.setState((state) => ({
    bufferCache: { ...state.bufferCache, [terminalId]: data },
  }));
};

export const getBuffer = (terminalId: string): string | null =>
  terminalStore.getState().bufferCache[terminalId] ?? null;

export const clearBuffer = (terminalId: string) => {
  terminalStore.setState((state) => {
    const { [terminalId]: _removed, ...next } = state.bufferCache;

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
    const { [fromId]: _removedSessions, ...restSessions } = state.sessions;
    const newSessions = {
      ...restSessions,
      [toId]: [
        ...existing,
        ...sessionsToMove.map((s) => ({ ...s, session_id: toId })),
      ],
    };
    const fromActive = state.activeSessionId[fromId];
    const toActive = state.activeSessionId[toId];
    const { [fromId]: _removedActive, ...restActive } = state.activeSessionId;
    const newActiveSessionId = {
      ...restActive,
      [toId]: toActive ?? fromActive ?? null,
    };

    return {
      sessions: newSessions,
      activeSessionId: newActiveSessionId,
    };
  });
};

const EMPTY_SESSIONS: TerminalSession[] = [];

export const useTerminalSessionsSlice = (sessionId: string) =>
  useTerminalStore((s) => s.sessions[sessionId] ?? EMPTY_SESSIONS);

export const useActiveSessionId = (sessionId: string) =>
  useTerminalStore((s) => s.activeSessionId[sessionId] ?? null);

export const useRunSessionId = (sessionId: string) =>
  useTerminalStore((s) => s.runSessionId[sessionId] ?? null);

export const useRunBusy = (sessionId: string) =>
  useTerminalStore((s) => s.runBusy[sessionId] ?? false);

export const setRunningTerminal = (
  sessionId: string,
  title: string,
  terminalId: string | null,
) => {
  terminalStore.setState((state) => {
    const existing = state.runningTerminals[sessionId] ?? {};
    if (terminalId === null) {
      const { [title]: _removed, ...rest } = existing;
      if (Object.keys(rest).length === 0) {
        const { [sessionId]: _dropped, ...remaining } = state.runningTerminals;

        return { runningTerminals: remaining };
      }

      return {
        runningTerminals: { ...state.runningTerminals, [sessionId]: rest },
      };
    }

    return {
      runningTerminals: {
        ...state.runningTerminals,
        [sessionId]: { ...existing, [title]: terminalId },
      },
    };
  });
};

/**
 * Clear the running-terminal marker only if it still points at `terminalId`.
 * Used on pty-exit to avoid racing a rerun that has already re-populated the
 * slot with a fresh terminal id.
 */
export const clearRunningTerminalIfMatches = (
  sessionId: string,
  title: string,
  terminalId: string,
) => {
  const current = terminalStore.getState().runningTerminals[sessionId]?.[title];
  if (current === terminalId) {
    setRunningTerminal(sessionId, title, null);
  }
};

const EMPTY_RUNNING: Record<string, string> = {};

export const useRunningTerminalsForSession = (sessionId: string) =>
  useTerminalStore((s) => s.runningTerminals[sessionId] ?? EMPTY_RUNNING);

export const useSessionIsRunning = (sessionId: string) =>
  useTerminalStore(
    (s) => Object.keys(s.runningTerminals[sessionId] ?? {}).length > 0,
  );

export const useAllRunningTerminals = () =>
  useTerminalStore((s) => s.runningTerminals);

export const useLiveSessions = () => useTerminalStore((s) => s.liveSessions);

export const useTotalRunningTerminals = () =>
  useTerminalStore((s) => {
    let count = 0;
    for (const perSession of Object.values(s.runningTerminals)) {
      count += Object.keys(perSession).length;
    }

    return count;
  });

/** For tests */
export const getTerminalState = () => terminalStore.getState();
export const setTerminalState = terminalStore.setState.bind(terminalStore);
