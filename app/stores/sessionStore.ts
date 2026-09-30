import type { ImageAttachment } from "../lib/ipc";
import type { DeleteProgress, SetupProgress } from "../lib/sessionProgress";
import type { HostId } from "../lib/transport/hostId";
import type { Session } from "../lib/types";
import { create } from "zustand";
import { useRouteSessionId } from "../lib/routeHooks";
import { appNavigate, getCurrentRoute } from "../lib/router";
import { LOCAL_HOST_ID, hostScopedKey } from "../lib/transport/hostId";
import { rememberSessionHost, sessionHost } from "../lib/transport/hostIndex";
import { forgetSessionPanel, getLastPanelForSession } from "./editorStore";
import { forgetSessionTools } from "./layoutStore";
import { migrateSessions } from "./terminalStore";

export interface Project {
  addedAt: number;
  /** Machine this repo lives on — two hosts may hold the same path. */
  hostId: HostId;
  isCollapsed: boolean;
  repoBranch: string | null;
  repoRoot: string;
}

/** Stable identity for a project across hosts, for React keys and drag targets. */
export const projectKey = (project: Pick<Project, "hostId" | "repoRoot">) =>
  hostScopedKey(project.hostId, project.repoRoot);

/** Which host a session's worktree is on. */
export const sessionHostId = (sessionId: string): HostId =>
  sessionHost(sessionId) ?? LOCAL_HOST_ID;

const ownedBy = (session: Session, repoRoot: string, hostId: HostId) =>
  session.repo_root === repoRoot && sessionHostId(session.id) === hostId;

interface SessionStoreData {
  /** How much of a session's worktree is gone while it is being deleted. */
  deleteProgressBySessionId: Record<string, DeleteProgress>;
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
  setupProgressBySessionId: Record<string, SetupProgress>;
}

const sessionStore = create<SessionStoreData>(() => ({
  projects: [],
  sessions: [],
  isLoading: false,
  setupProgressBySessionId: {},
  deleteProgressBySessionId: {},
  pendingPromptBySessionId: {},
}));

const useSessionStore = sessionStore;

export const addProject = (
  repoRoot: string,
  hostId: HostId = LOCAL_HOST_ID,
) => {
  sessionStore.setState((state) => {
    if (
      state.projects.some((p) => p.repoRoot === repoRoot && p.hostId === hostId)
    ) {
      return state;
    }

    return {
      projects: [
        ...state.projects,
        {
          repoRoot,
          hostId,
          repoBranch: null,
          isCollapsed: false,
          addedAt: Date.now(),
        },
      ],
    };
  });
};

export const removeProject = (
  repoRoot: string,
  hostId: HostId = LOCAL_HOST_ID,
) => {
  const selectedId = getSelectedSessionId();
  let removedIds: string[] = [];
  sessionStore.setState((state) => {
    const wsIds = state.sessions
      .filter((w) => ownedBy(w, repoRoot, hostId))
      .map((w) => w.id);
    removedIds = wsIds;
    const selectedGone = selectedId != null && wsIds.includes(selectedId);
    if (selectedGone) {
      appNavigate({ view: "home" });
    }

    const removed = new Set(wsIds);

    return {
      projects: state.projects.filter(
        (p) => p.repoRoot !== repoRoot || p.hostId !== hostId,
      ),
      sessions: state.sessions.filter((w) => !removed.has(w.id)),
    };
  });
  for (const id of removedIds) {
    forgetSessionTools(id);
    forgetSessionPanel(id);
  }
};

/** Reorder by `projectKey()` — the same path on two hosts is two rows. */
export const reorderProjects = (
  fromKey: string,
  toKey: string,
  position: "after" | "before",
) => {
  sessionStore.setState((state) => {
    const fromIdx = state.projects.findIndex((p) => projectKey(p) === fromKey);
    const toIdx = state.projects.findIndex((p) => projectKey(p) === toKey);
    if (fromIdx === -1 || toIdx === -1 || fromKey === toKey) {
      return state;
    }
    const next = [...state.projects];
    const [moved] = next.splice(fromIdx, 1);
    const insertIdx = next.findIndex((p) => projectKey(p) === toKey);
    const anchor = position === "after" ? insertIdx + 1 : insertIdx;
    next.splice(anchor, 0, moved);

    return { projects: next };
  });
};

export const reorderSessions = (
  fromId: string,
  toId: string,
  position: "after" | "before",
) => {
  if (fromId === toId) {
    return;
  }
  sessionStore.setState((state) => {
    const fromIdx = state.sessions.findIndex((s) => s.id === fromId);
    const toIdx = state.sessions.findIndex((s) => s.id === toId);
    if (fromIdx === -1 || toIdx === -1) {
      return state;
    }
    const from = state.sessions[fromIdx];
    const to = state.sessions[toIdx];
    if (
      from.repo_root !== to.repo_root ||
      sessionHostId(from.id) !== sessionHostId(to.id)
    ) {
      return state;
    }
    const next = [...state.sessions];
    const [moved] = next.splice(fromIdx, 1);
    const insertIdx = next.findIndex((s) => s.id === toId);
    const anchor = position === "after" ? insertIdx + 1 : insertIdx;
    next.splice(anchor, 0, moved);

    return { sessions: next };
  });
};

export const setProjectBranch = (
  repoRoot: string,
  branch: string | null,
  hostId: HostId = LOCAL_HOST_ID,
) => {
  sessionStore.setState((state) => ({
    projects: state.projects.map((p) =>
      p.repoRoot === repoRoot && p.hostId === hostId
        ? { ...p, repoBranch: branch }
        : p,
    ),
  }));
};

export const toggleProjectCollapsed = (
  repoRoot: string,
  hostId: HostId = LOCAL_HOST_ID,
) => {
  sessionStore.setState((state) => ({
    projects: state.projects.map((p) =>
      p.repoRoot === repoRoot && p.hostId === hostId
        ? { ...p, isCollapsed: !p.isCollapsed }
        : p,
    ),
  }));
};

/** Drop everything a detached host contributed to the sidebar. */
export const dropHostSessions = (hostId: HostId) => {
  sessionStore.setState((state) => ({
    projects: state.projects.filter((p) => p.hostId !== hostId),
    sessions: state.sessions.filter((w) => sessionHostId(w.id) !== hostId),
  }));
};

export const setSessions = (sessions: Session[]) => {
  sessionStore.setState({ sessions });
};

export const mergeSessionsForProject = (
  repoRoot: string,
  incoming: Session[],
  hostId: HostId = LOCAL_HOST_ID,
) => {
  for (const session of incoming) {
    rememberSessionHost(session.id, hostId);
  }
  sessionStore.setState((state) => {
    const normalizePath = (p: string) =>
      p.replace(/\\/g, "/").replace(/\/+$/, "").replace(/\/+/g, "/");

    const existing = state.sessions.filter((w) => ownedBy(w, repoRoot, hostId));
    const byPath = new Map(existing.map((w) => [normalizePath(w.path), w]));

    const merged = incoming.map((backend) => {
      const key = normalizePath(backend.path);
      const prev = byPath.get(key);
      if (prev) {
        rememberSessionHost(prev.id, hostId);

        return { ...backend, id: prev.id };
      }

      return backend;
    });

    // Preserve user-defined ordering: sort merged sessions by their previous
    // index in the local store. New sessions (not present before) keep their
    // backend-provided order and are appended at the end.
    const prevOrder = new Map(existing.map((w, idx) => [w.id, idx]));
    merged.sort((a, b) => {
      const ai = prevOrder.get(a.id);
      const bi = prevOrder.get(b.id);
      if (ai === undefined && bi === undefined) {
        return 0;
      }
      if (ai === undefined) {
        return 1;
      }
      if (bi === undefined) {
        return -1;
      }

      return ai - bi;
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

    const existingIds = new Set(existing.map((w) => w.id));
    const otherSessions = state.sessions.filter((w) => !existingIds.has(w.id));

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

export const addSession = (
  session: Session,
  hostId: HostId = LOCAL_HOST_ID,
) => {
  rememberSessionHost(session.id, hostId);
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
    const { [id]: _deleted, ...deleteProgress } =
      state.deleteProgressBySessionId;

    return {
      sessions: state.sessions.filter((w) => w.id !== id),
      pendingPromptBySessionId: pending,
      deleteProgressBySessionId: deleteProgress,
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
      // Selecting a session on another machine moves the view there too —
      // the session and everything it opens belong to that host.
      hostId: sessionHostId(id),
      panel: getLastPanelForSession(id) ?? "home",
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
  progress: SetupProgress | null,
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

export const setDeleteProgress = (
  sessionId: string,
  progress: DeleteProgress | null,
) => {
  sessionStore.setState((state) => {
    const { [sessionId]: _removed, ...next } = state.deleteProgressBySessionId;

    return {
      deleteProgressBySessionId: progress
        ? { ...next, [sessionId]: progress }
        : next,
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

export const useDeleteProgressBySessionId = () =>
  useSessionStore((s) => s.deleteProgressBySessionId);

/** Non-hook accessor for the currently selected session id (from URL). */
export const getSelectedSessionId = (): string | null =>
  getCurrentRoute().sessionId;

/** For tests — the Zustand slice (sessions, projects, setup progress). */
export const getSessionState = () => sessionStore.getState();
export const setSessionState = sessionStore.setState.bind(sessionStore);
