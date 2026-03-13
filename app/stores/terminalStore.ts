import { create } from "zustand";
import type { TerminalSession } from "../lib/types";

interface TerminalState {
  // Map of workspaceId -> active session id
  activeSessionId: Record<string, null | string>;
  addSession: (session: TerminalSession) => void;
  /** Serialized xterm buffer cache for unmounted terminals. */
  bufferCache: Record<string, string>;
  cacheBuffer: (sessionId: string, data: string) => void;

  /** Remove cached buffer (call when session is destroyed). */
  clearBuffer: (sessionId: string) => void;
  getActiveSessionId: (workspaceId: string) => null | string;
  /** Read cached buffer (non-destructive — survives StrictMode double-mount). */
  getBuffer: (sessionId: string) => null | string;
  getRunSessionId: (workspaceId: string) => null | string;
  getSessionsForWorkspace: (workspaceId: string) => TerminalSession[];
  isRunBusy: (workspaceId: string) => boolean;
  /** Move sessions from one workspace ID to another (e.g. when ID changes after merge). */
  migrateSessions: (fromId: string, toId: string) => void;
  removeSession: (workspaceId: string, sessionId: string) => void;
  // Map of workspaceId -> whether the run command is executing
  runBusy: Record<string, boolean>;
  // Map of workspaceId -> run terminal session id
  runSessionId: Record<string, null | string>;
  // Map of workspaceId -> list of sessions
  sessions: Record<string, TerminalSession[]>;
  setActiveSession: (workspaceId: string, sessionId: null | string) => void;
  setRunBusy: (workspaceId: string, busy: boolean) => void;
  setRunSession: (workspaceId: string, sessionId: null | string) => void;
  updateSession: (sessionId: string, patch: Partial<TerminalSession>) => void;
}

export const useTerminalStore = create<TerminalState>((set, get) => ({
  sessions: {},
  activeSessionId: {},
  runSessionId: {},
  runBusy: {},
  bufferCache: {},

  addSession: (session) =>
    set((state) => {
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
    }),

  removeSession: (workspaceId, sessionId) =>
    set((state) => {
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
    }),

  setActiveSession: (workspaceId, sessionId) =>
    set((state) => ({
      activeSessionId: {
        ...state.activeSessionId,
        [workspaceId]: sessionId,
      },
    })),

  getSessionsForWorkspace: (workspaceId) => get().sessions[workspaceId] ?? [],

  getActiveSessionId: (workspaceId) =>
    get().activeSessionId[workspaceId] ?? null,

  updateSession: (sessionId, patch) =>
    set((state) => {
      const updatedSessions: Record<string, TerminalSession[]> = {};
      for (const [wid, list] of Object.entries(state.sessions)) {
        updatedSessions[wid] = list.map((s) =>
          s.id === sessionId ? { ...s, ...patch } : s,
        );
      }
      return { sessions: updatedSessions };
    }),

  setRunSession: (workspaceId, sessionId) =>
    set((state) => ({
      runSessionId: { ...state.runSessionId, [workspaceId]: sessionId },
    })),

  setRunBusy: (workspaceId, busy) =>
    set((state) => ({
      runBusy: { ...state.runBusy, [workspaceId]: busy },
    })),

  getRunSessionId: (workspaceId) => get().runSessionId[workspaceId] ?? null,

  isRunBusy: (workspaceId) => get().runBusy[workspaceId] ?? false,

  cacheBuffer: (sessionId, data) =>
    set((state) => ({
      bufferCache: { ...state.bufferCache, [sessionId]: data },
    })),

  getBuffer: (sessionId) => get().bufferCache[sessionId] ?? null,

  clearBuffer: (sessionId) =>
    set((state) => {
      const next = { ...state.bufferCache };
      delete next[sessionId];
      return { bufferCache: next };
    }),

  migrateSessions: (fromId, toId) =>
    set((state) => {
      if (fromId === toId) return state;
      const sessionsToMove = state.sessions[fromId] ?? [];
      if (sessionsToMove.length === 0) return state;
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
    }),
}));
