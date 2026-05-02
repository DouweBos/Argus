import type { ImageAttachment } from "../lib/ipc";
import type { Session } from "../lib/types";
import { create } from "zustand";
import { useRouteSessionId } from "../lib/routeHooks";
import { appNavigate, getCurrentRoute } from "../lib/router";
import {
  forgetSessionPanel,
  getActiveCenterView,
  getLastPanelForSession,
} from "./editorStore";
import { forgetSessionTools } from "./layoutStore";
import { migrateSessions } from "./terminalStore";

export interface Project {
  addedAt: number;
  isCollapsed: boolean;
  repoBranch: string | null;
  repoRoot: string;
}

interface SessionStoreData {
  isLoading: boolean;
  /**
   * Prompts that should be dispatched to a freshly-spawned agent once the
   * session finishes resolving. The key is the session id; value is the
   * user-authored prompt captured at session-creation time. The worktree
   * may not exist yet when this is set, so no agent is started — the
   * subscription in `app/lib/pendingSessionPrompts.ts` picks it up when
   * the session transitions to `ready`.
   */
  pendingPromptBySessionId: Record<
    string,
    {
      images?: ImageAttachment[];
      /** Extra project roots to attach to the agent before the prompt is sent. */
      linkedProjects?: string[];
      /** CLI model identifier (e.g. `claude-opus-4-7`) — undefined uses the default. */
      model?: string;
      prompt: string;
    }
  >;
  projects: Project[];
  sessions: Session[];
  /** Current item and progress during setup. Cleared when setup completes. */
  setupProgressBySessionId: Record<
    string,
    {
      current: number;
      item: string;
      phase?: "command" | "copy" | "matching" | "symlink";
      total: number;
    }
  >;
}

const sessionStore = create<SessionStoreData>(() => ({
  projects: [],
  sessions: [],
  isLoading: false,
  setupProgressBySessionId: {},
  pendingPromptBySessionId: {},
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
  let removedIds: string[] = [];
  sessionStore.setState((state) => {
    const wsIds = state.sessions
      .filter((w) => w.repo_root === repoRoot)
      .map((w) => w.id);
    removedIds = wsIds;
    const selectedGone = selectedId != null && wsIds.includes(selectedId);
    if (selectedGone) {
      appNavigate({ view: "home" });
    }

    return {
      projects: state.projects.filter((p) => p.repoRoot !== repoRoot),
      sessions: state.sessions.filter((w) => w.repo_root !== repoRoot),
    };
  });
  for (const id of removedIds) {
    forgetSessionTools(id);
    forgetSessionPanel(id);
  }
};

export const reorderProjects = (
  fromRoot: string,
  toRoot: string,
  position: "after" | "before",
) => {
  sessionStore.setState((state) => {
    const fromIdx = state.projects.findIndex((p) => p.repoRoot === fromRoot);
    const toIdx = state.projects.findIndex((p) => p.repoRoot === toRoot);
    if (fromIdx === -1 || toIdx === -1 || fromRoot === toRoot) {
      return state;
    }
    const next = [...state.projects];
    const [moved] = next.splice(fromIdx, 1);
    const insertIdx = next.findIndex((p) => p.repoRoot === toRoot);
    const anchor = position === "after" ? insertIdx + 1 : insertIdx;
    next.splice(anchor, 0, moved);

    return { projects: next };
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

    // Preserve in-flight placeholders — the backend hasn't materialized them
    // on disk yet (no worktree path) so they would otherwise be wiped by the
    // merge and reappear only once finalizeSession resolves.
    const mergedIdSet = new Set(merged.map((w) => w.id));
    const placeholders = existing.filter(
      (w) => !mergedIdSet.has(w.id) && !w.path,
    );

    return { sessions: [...otherSessions, ...merged, ...placeholders] };
  });
};

export const addSession = (session: Session) => {
  sessionStore.setState((state) => {
    if (state.sessions.some((w) => w.id === session.id)) {
      return state;
    }

    return { sessions: [...state.sessions, session] };
  });
};

export const removeSession = (id: string) => {
  if (getSelectedSessionId() === id) {
    appNavigate({ view: "home" });
  }
  sessionStore.setState((state) => {
    const { [id]: _removed, ...pending } = state.pendingPromptBySessionId;

    return {
      sessions: state.sessions.filter((w) => w.id !== id),
      pendingPromptBySessionId: pending,
    };
  });
  forgetSessionTools(id);
  forgetSessionPanel(id);
};

export const updateSession = (id: string, patch: Partial<Session>) => {
  sessionStore.setState((state) => ({
    sessions: state.sessions.map((w) => (w.id === id ? { ...w, ...patch } : w)),
  }));
};

export const selectSession = (id: string | null) => {
  if (id !== null) {
    appNavigate({
      view: "session",
      sessionId: id,
      panel: getLastPanelForSession(id) ?? getActiveCenterView(),
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
  progress: {
    current: number;
    item: string;
    phase?: "command" | "copy" | "matching" | "symlink";
    total: number;
  } | null,
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

export interface PendingPromptOptions {
  images?: ImageAttachment[];
  linkedProjects?: string[];
  model?: string;
}

export const setPendingPrompt = (
  sessionId: string,
  prompt: string,
  options?: PendingPromptOptions,
) => {
  const { images, linkedProjects, model } = options ?? {};
  sessionStore.setState((state) => ({
    pendingPromptBySessionId: {
      ...state.pendingPromptBySessionId,
      [sessionId]: {
        prompt,
        images: images?.length ? images : undefined,
        linkedProjects: linkedProjects?.length ? linkedProjects : undefined,
        model,
      },
    },
  }));
};

export const consumePendingPrompt = (
  sessionId: string,
): {
  images?: ImageAttachment[];
  linkedProjects?: string[];
  model?: string;
  prompt: string;
} | null => {
  const state = sessionStore.getState();
  const entry = state.pendingPromptBySessionId[sessionId];
  if (entry === undefined) {
    return null;
  }
  const { [sessionId]: _removed, ...rest } = state.pendingPromptBySessionId;
  sessionStore.setState({ pendingPromptBySessionId: rest });

  return entry;
};

export const clearPendingPrompt = (sessionId: string) => {
  sessionStore.setState((state) => {
    if (!(sessionId in state.pendingPromptBySessionId)) {
      return state;
    }
    const { [sessionId]: _removed, ...rest } = state.pendingPromptBySessionId;

    return { pendingPromptBySessionId: rest };
  });
};

export const subscribeSessionStore = sessionStore.subscribe.bind(sessionStore);

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
