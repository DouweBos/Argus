import type { Session } from "../lib/types";
import { create } from "zustand";
import { useRouteSessionId } from "../lib/routeHooks";
import { appNavigate, getCurrentRoute } from "../lib/router";
import { getActiveCenterView } from "./editorStore";
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
  const selectedId = getSelectedSessionId();
  sessionStore.setState((state) => {
    const wsIds = state.sessions
      .filter((w) => w.repo_root === repoRoot)
      .map((w) => w.id);
    const selectedGone = selectedId != null && wsIds.includes(selectedId);
    if (selectedGone) {
      appNavigate({ view: "home" });
    }

    return {
      projects: state.projects.filter((p) => p.repoRoot !== repoRoot),
      sessions: state.sessions.filter((w) => w.repo_root !== repoRoot),
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
    const pendingPlaceholders = existing.filter((w) =>
      w.id.startsWith("pending-"),
    );

    return { sessions: [...otherSessions, ...merged, ...pendingPlaceholders] };
  });
};

export const addSession = (session: Session) => {
  sessionStore.setState((state) => ({
    sessions: [...state.sessions, session],
  }));
};

export const removeSession = (id: string) => {
  if (getSelectedSessionId() === id) {
    appNavigate({ view: "home" });
  }
  sessionStore.setState((state) => ({
    sessions: state.sessions.filter((w) => w.id !== id),
  }));
};

export const updateSession = (id: string, patch: Partial<Session>) => {
  sessionStore.setState((state) => ({
    sessions: state.sessions.map((w) => (w.id === id ? { ...w, ...patch } : w)),
  }));
};

/**
 * Replace an optimistic placeholder session with the real one returned by the
 * backend. Migrates terminal/id state and, if the URL currently points at the
 * temp id, redirects to the real one.
 */
export const replaceSession = (tempId: string, session: Session) => {
  if (tempId === session.id) {
    updateSession(session.id, session);

    return;
  }
  migrateSessions(tempId, session.id);
  const wasSelected = getSelectedSessionId() === tempId;
  sessionStore.setState((state) => ({
    sessions: state.sessions.map((w) => (w.id === tempId ? session : w)),
  }));
  if (wasSelected) {
    appNavigate(
      {
        view: "session",
        sessionId: session.id,
        panel: getActiveCenterView(),
      },
      { replace: true },
    );
  }
};

export const selectSession = (id: string | null) => {
  if (id !== null) {
    appNavigate({
      view: "session",
      sessionId: id,
      panel: getActiveCenterView(),
    });
  } else {
    appNavigate({ view: "home" });
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

/** URL-derived: returns the session id from the current path. */
export const useSelectedSessionId = (): string | null => useRouteSessionId();

export const useSessionLoading = () => useSessionStore((s) => s.isLoading);

export const useSessions = () => useSessionStore((s) => s.sessions);

export const useSetupProgressBySessionId = () =>
  useSessionStore((s) => s.setupProgressBySessionId);

/** Non-hook accessor for the currently selected session id (from URL). */
export const getSelectedSessionId = (): string | null =>
  getCurrentRoute().sessionId;

/** For tests — the Zustand slice (sessions, projects, setup progress). */
export const getSessionState = () => sessionStore.getState();
export const setSessionState = sessionStore.setState.bind(sessionStore);
