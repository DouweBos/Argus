import type { Session } from "../lib/types";
import { create } from "zustand";
import { pushRoute } from "../lib/router";
import { clearSelectedOrganization } from "./centerViewStore";
import { getEditorState } from "./editorStore";
import { migrateSessions } from "./terminalStore";

export interface Project {
  addedAt: number;
  isCollapsed: boolean;
  repoBranch: string | null;
  repoRoot: string;
}

interface SessionStoreData {
  isLoading: boolean;
  projects: Project[];
  selectedId: string | null;
  sessions: Session[];
  /** Current item and progress during setup. Cleared when setup completes. */
  setupProgressBySessionId: Record<
    string,
    { current: number; item: string; total: number }
  >;
}

const sessionStore = create<SessionStoreData>(() => ({
  projects: [],
  sessions: [],
  selectedId: null,
  isLoading: false,
  setupProgressBySessionId: {},
}));

const useSessionStore = sessionStore;

export const addProject = (repoRoot: string) => {
  sessionStore.setState((state) => {
    if (state.projects.some((p) => p.repoRoot === repoRoot)) {
      return state;
    }

    return {
      projects: [
        ...state.projects,
        {
          repoRoot,
          repoBranch: null,
          isCollapsed: false,
          addedAt: Date.now(),
        },
      ],
    };
  });
};

export const removeProject = (repoRoot: string) => {
  sessionStore.setState((state) => {
    const wsIds = state.sessions
      .filter((w) => w.repo_root === repoRoot)
      .map((w) => w.id);
    const selectedGone =
      state.selectedId != null && wsIds.includes(state.selectedId);

    return {
      projects: state.projects.filter((p) => p.repoRoot !== repoRoot),
      sessions: state.sessions.filter((w) => w.repo_root !== repoRoot),
      selectedId: selectedGone ? null : state.selectedId,
    };
  });
};

export const setProjectBranch = (repoRoot: string, branch: string | null) => {
  sessionStore.setState((state) => ({
    projects: state.projects.map((p) =>
      p.repoRoot === repoRoot ? { ...p, repoBranch: branch } : p,
    ),
  }));
};

export const toggleProjectCollapsed = (repoRoot: string) => {
  sessionStore.setState((state) => ({
    projects: state.projects.map((p) =>
      p.repoRoot === repoRoot ? { ...p, isCollapsed: !p.isCollapsed } : p,
    ),
  }));
};

export const setSessions = (sessions: Session[]) => {
  sessionStore.setState({ sessions });
};

export const mergeSessionsForProject = (
  repoRoot: string,
  incoming: Session[],
) => {
  sessionStore.setState((state) => {
    const normalizePath = (p: string) =>
      p.replace(/\\/g, "/").replace(/\/+$/, "").replace(/\/+/g, "/");

    const existing = state.sessions.filter((w) => w.repo_root === repoRoot);
    const byPath = new Map(existing.map((w) => [normalizePath(w.path), w]));

    const merged = incoming.map((backend) => {
      const key = normalizePath(backend.path);
      const prev = byPath.get(key);
      if (prev) {
        return { ...backend, id: prev.id };
      }

      return backend;
    });

    const mergedIds = new Set(merged.map((w) => w.id));
    const mergedByPath = new Map(merged.map((w) => [normalizePath(w.path), w]));
    for (const oldWs of existing) {
      if (mergedIds.has(oldWs.id)) {
        continue;
      }
      const newWs = mergedByPath.get(normalizePath(oldWs.path));
      if (newWs && newWs.id !== oldWs.id) {
        migrateSessions(oldWs.id, newWs.id);
      }
    }

    const otherSessions = state.sessions.filter(
      (w) => w.repo_root !== repoRoot,
    );

    // Preserve optimistic placeholders for this repo — the backend hasn't
    // materialized them yet (no path) so they would otherwise be wiped by the
    // merge and reappear only once create_session resolves.
    const pendingPlaceholders = existing.filter((w) => w.id.startsWith("pending-"));

    return { sessions: [...otherSessions, ...merged, ...pendingPlaceholders] };
  });
};

export const addSession = (session: Session) => {
  sessionStore.setState((state) => ({
    sessions: [...state.sessions, session],
  }));
};

export const removeSession = (id: string) => {
  sessionStore.setState((state) => ({
    sessions: state.sessions.filter((w) => w.id !== id),
    selectedId: state.selectedId === id ? null : state.selectedId,
  }));
};

export const updateSession = (id: string, patch: Partial<Session>) => {
  sessionStore.setState((state) => ({
    sessions: state.sessions.map((w) => (w.id === id ? { ...w, ...patch } : w)),
  }));
};

/**
 * Replace an optimistic placeholder session with the real one returned by the
 * backend, preserving its position in the list and migrating selection +
 * terminal state to the new id.
 */
export const replaceSession = (tempId: string, session: Session) => {
  if (tempId === session.id) {
    updateSession(session.id, session);

    return;
  }
  migrateSessions(tempId, session.id);
  const wasSelected = sessionStore.getState().selectedId === tempId;
  // Apply the sessions swap and the selectedId migration in a single
  // setState so no render ever sees `selectedId === tempId` while the
  // sessions list has already moved on to the real id — that intermediate
  // state causes CenterPanel to fall back to HomeScreen.
  sessionStore.setState((state) => ({
    sessions: state.sessions.map((w) => (w.id === tempId ? session : w)),
    selectedId: wasSelected ? session.id : state.selectedId,
  }));
  if (wasSelected) {
    clearSelectedOrganization();
    pushRoute({
      view: "session",
      sessionId: session.id,
      panel: getEditorState().activeCenterView,
    });
  }
};

export const selectSession = (id: string | null) => {
  sessionStore.setState({ selectedId: id });
  if (id !== null) {
    clearSelectedOrganization();
    pushRoute({
      view: "session",
      sessionId: id,
      panel: getEditorState().activeCenterView,
    });
  } else {
    pushRoute({ view: "home" });
  }
};

export const setLoading = (isLoading: boolean) => {
  sessionStore.setState({ isLoading });
};

export const setSetupProgress = (
  sessionId: string,
  progress: { current: number; item: string; total: number } | null,
) => {
  sessionStore.setState((state) => {
    if (progress == null) {
      const { [sessionId]: _removed, ...next } = state.setupProgressBySessionId;

      return { setupProgressBySessionId: next };
    }

    return {
      setupProgressBySessionId: {
        ...state.setupProgressBySessionId,
        [sessionId]: progress,
      },
    };
  });
};

export const useSessionProjects = () => useSessionStore((s) => s.projects);

export const useSelectedSessionId = () => useSessionStore((s) => s.selectedId);

export const useSessionLoading = () => useSessionStore((s) => s.isLoading);

export const useSessions = () => useSessionStore((s) => s.sessions);

export const useSetupProgressBySessionId = () =>
  useSessionStore((s) => s.setupProgressBySessionId);

/** For tests */
export const getSessionState = () => sessionStore.getState();
export const setSessionState = sessionStore.setState.bind(sessionStore);
