import type { Session } from "../lib/types";
import { useCallback, useEffect, useMemo, useRef } from "react";
import { stopAgentListening } from "../lib/agentEventService";
import { listen } from "../lib/events";
import {
  addRepoRoot as apiAddRepoRoot,
  createHeadSession as apiCreateHeadSession,
  createSession as apiCreateSession,
  deleteSession as apiDeleteSession,
  removeRepoRoot as apiRemoveRepoRoot,
  getRepoBranch,
  listSessions,
} from "../lib/ipc";
import { seedReviewStateForSession } from "../lib/reviewQueueService";
import { getAgentState, removeAgent } from "../stores/agentStore";
import { pushError } from "../stores/notificationsStore";
import {
  addOpenProject,
  addRecentProject,
  getOpenProjects,
  removeOpenProject,
} from "../stores/recentProjectsStore";
import {
  addProject,
  addSession,
  getSessionState,
  mergeSessionsForProject,
  removeProject,
  removeSession,
  selectSession,
  setProjectBranch,
  setSetupProgress,
  updateSession,
  useSelectedSessionId,
  useSessionLoading,
  useSessionProjects,
  useSessions,
} from "../stores/sessionStore";
import { isWindowFocused } from "./useWindowFocus";

// ---------------------------------------------------------------------------
// Shared event-listener helpers
// ---------------------------------------------------------------------------

function setupSessionStatusListener(sessionId: string): Promise<() => void> {
  return listen<string>(`session:status:${sessionId}`, (event) => {
    const payload = event.payload;
    let status: "deleting" | "initializing" | "ready" | { error: string };
    if (payload === "ready") {
      status = "ready";
      setSetupProgress(sessionId, null);
    } else if (payload === "deleting") {
      status = "deleting";
      setSetupProgress(sessionId, null);
    } else if (payload.startsWith("error:")) {
      status = { error: payload.slice(6) };
      // Keep the last setup progress so the UI can show which step failed.
    } else {
      status = "initializing";
    }

    updateSession(sessionId, { status });
  });
}

function setupSessionProgressListener(sessionId: string): Promise<() => void> {
  return listen<string>(`session:setup_progress:${sessionId}`, (event) => {
    try {
      const data = JSON.parse(event.payload) as {
        current: number;
        item: string;
        total: number;
      };
      if (
        typeof data.item === "string" &&
        typeof data.current === "number" &&
        typeof data.total === "number"
      ) {
        setSetupProgress(sessionId, data);
      }
    } catch {
      // Ignore malformed payload
    }
  });
}

// ---------------------------------------------------------------------------
// useProjects — top-level hook for managing open projects
// ---------------------------------------------------------------------------

export function useProjects() {
  const projects = useSessionProjects();
  const selectedId = useSelectedSessionId();
  const isLoading = useSessionLoading();

  const openProject = useCallback(
    async (
      path: string,
      options?: { autoSelect?: boolean; skipRecent?: boolean },
    ) => {
      try {
        await apiAddRepoRoot(path);
        addProject(path);

        await apiCreateHeadSession(path);

        const sessions = await listSessions(path);
        mergeSessionsForProject(path, sessions);

        // Seed the review queue with the current commits-ahead count for each
        // worktree — worktrees may have accumulated changes in a previous
        // session. repo_root sessions are skipped upstream in the backend.
        for (const ws of sessions) {
          if (ws.kind === "worktree") {
            seedReviewStateForSession(ws.id).catch(() => {});
          }
        }

        try {
          const branch = await getRepoBranch(path);
          setProjectBranch(path, branch);
        } catch {
          setProjectBranch(path, null);
        }

        const shouldAutoSelect = options?.autoSelect !== false;
        const projectSessions = getSessionState().sessions.filter(
          (w) => w.repo_root === path,
        );
        if (
          shouldAutoSelect &&
          projectSessions.length > 0 &&
          getSessionState().selectedId === null
        ) {
          const repoRootWs = projectSessions.find(
            (w) => w.kind === "project_root",
          );
          selectSession((repoRootWs ?? projectSessions[0]).id);
        }

        if (!options?.skipRecent) {
          addRecentProject(path);
        }
        addOpenProject(path);
      } catch (err) {
        pushError(
          err instanceof Error ? err.message : String(err),
          "open_project",
        );
        throw err;
      }
    },
    [],
  );

  const closeProject = useCallback(async (repoRoot: string) => {
    try {
      await apiRemoveRepoRoot(repoRoot);
      removeProject(repoRoot);
      removeOpenProject(repoRoot);
    } catch (err) {
      pushError(
        err instanceof Error ? err.message : String(err),
        "close_project",
      );
    }
  }, []);

  useEffect(() => {
    const open = getOpenProjects();
    if (open.length > 0) {
      const sorted = [...open].sort((a, b) => a.addedAt - b.addedAt);
      (async () => {
        for (const p of sorted) {
          try {
            await openProject(p.path, { autoSelect: false, skipRecent: true });
          } catch {
            removeOpenProject(p.path);
          }
        }
      })();
    }
  }, [openProject]);

  useEffect(() => {
    const unlisten = listen<{ error: string; id: string }>(
      "session:delete-failed",
      (event) => {
        const { error: message } = event.payload;
        pushError(`Failed to delete session: ${message}`, "delete_session");
      },
    );

    return () => {
      unlisten.then((fn) => fn());
    };
  }, []);

  useEffect(() => {
    const unlisten = listen<string>("project:added", (event) => {
      const repoRoot = event.payload;
      openProject(repoRoot, { autoSelect: false, skipRecent: true }).catch(
        () => {},
      );
    });

    return () => {
      unlisten.then((fn) => fn());
    };
  }, [openProject]);

  useEffect(() => {
    const unlisten = listen<Session>("session:created", (event) => {
      const ws = event.payload;
      if (!getSessionState().sessions.some((w) => w.id === ws.id)) {
        addSession(ws);
      }
      if (ws.kind === "worktree") {
        seedReviewStateForSession(ws.id).catch(() => {});
      }
    });

    return () => {
      unlisten.then((fn) => fn());
    };
  }, []);

  useEffect(() => {
    const unlisten = listen<{ display_name?: string | null; id: string }>(
      "session:updated",
      (event) => {
        const { id, display_name } = event.payload;
        if (!getSessionState().sessions.some((w) => w.id === id)) {
          return;
        }
        updateSession(id, { display_name: display_name ?? null });
      },
    );

    return () => {
      unlisten.then((fn) => fn());
    };
  }, []);

  useEffect(() => {
    const unlisten = listen<string>("session:deleted", (event) => {
      const wsId = event.payload;
      // Purge any agents tracked for this session — the backend has
      // already killed their processes, but the renderer store would
      // otherwise keep showing them indefinitely.
      const agents = getAgentState().agents;
      for (const agent of Object.values(agents)) {
        if (agent.session_id === wsId) {
          stopAgentListening(agent.agent_id);
          removeAgent(agent.agent_id);
        }
      }
      if (getSessionState().sessions.some((w) => w.id === wsId)) {
        removeSession(wsId);
      }
    });

    return () => {
      unlisten.then((fn) => fn());
    };
  }, []);

  return {
    projects,
    selectedId,
    selectSession,
    openProject,
    closeProject,
    isLoading,
  };
}

// ---------------------------------------------------------------------------
// useProjectSessions — per-project hook for session management
// ---------------------------------------------------------------------------

export function useProjectSessions(repoRoot: string) {
  const allSessions = useSessions();
  const allProjects = useSessionProjects();
  const listenersRef = useRef<Map<string, () => void>>(new Map());

  const sessions = useMemo(
    () => allSessions.filter((w) => w.repo_root === repoRoot),
    [allSessions, repoRoot],
  );
  const project = useMemo(
    () => allProjects.find((p) => p.repoRoot === repoRoot),
    [allProjects, repoRoot],
  );
  const repoBranch = project?.repoBranch ?? null;

  const refresh = useCallback(async () => {
    try {
      const ws = await listSessions(repoRoot);
      mergeSessionsForProject(repoRoot, ws);
      try {
        const branch = await getRepoBranch(repoRoot);
        setProjectBranch(repoRoot, branch);
      } catch {
        setProjectBranch(repoRoot, null);
      }
    } catch {
      // Ignore refresh errors
    }
  }, [repoRoot]);

  const hasInitializing = sessions.some((w) => w.status === "initializing");
  useEffect(() => {
    if (!hasInitializing) {
      return;
    }
    const interval = setInterval(async () => {
      if (!isWindowFocused()) {
        return;
      }
      try {
        const ws = await listSessions(repoRoot);
        mergeSessionsForProject(repoRoot, ws);
      } catch {
        // Ignore poll errors
      }
    }, 500);

    return () => clearInterval(interval);
  }, [hasInitializing, repoRoot]);

  const repoRootSession = sessions.find((w) => w.kind === "project_root");
  const repoRootId = repoRootSession?.id ?? null;
  useEffect(() => {
    if (!repoRootId) {
      return;
    }
    const unlisten = listen<{ branch: string }>(
      `session:branch-changed:${repoRootId}`,
      (event) => {
        const { branch } = event.payload;
        setProjectBranch(repoRoot, branch);
        updateSession(repoRootId, { branch });
      },
    );

    return () => {
      unlisten.then((fn) => fn());
    };
  }, [repoRootId, repoRoot]);

  const sessionIds = sessions
    .map((w) => w.id)
    .sort()
    .join(",");
  useEffect(() => {
    const currentSessions = getSessionState().sessions.filter(
      (w) => w.repo_root === repoRoot,
    );
    const currentIds = new Set(currentSessions.map((w) => w.id));

    const toRemove: string[] = [];
    for (const [id] of listenersRef.current) {
      if (!currentIds.has(id)) {
        toRemove.push(id);
      }
    }

    for (const id of toRemove) {
      listenersRef.current.get(id)?.();
      listenersRef.current.delete(id);
    }

    for (const ws of currentSessions) {
      if (!listenersRef.current.has(ws.id)) {
        const id = ws.id;
        Promise.all([
          setupSessionStatusListener(id),
          setupSessionProgressListener(id),
        ]).then(([unlistenStatus, unlistenProgress]) => {
          listenersRef.current.set(id, () => {
            unlistenStatus();
            unlistenProgress();
          });
        });
      }
    }
  }, [sessionIds, repoRoot]);

  useEffect(() => {
    const listeners = listenersRef.current;

    return () => {
      listeners.forEach((unlisten) => unlisten());
      listeners.clear();
    };
  }, []);

  const createSession = useCallback(
    async (
      branch: string,
      description: string,
      useExistingBranch?: boolean,
      baseBranch?: string,
    ) => {
      try {
        const session = await apiCreateSession(
          repoRoot,
          branch,
          description,
          useExistingBranch,
          baseBranch,
        );
        addSession(session);
        selectSession(session.id);

        const [unlistenStatus, unlistenProgress] = await Promise.all([
          setupSessionStatusListener(session.id),
          setupSessionProgressListener(session.id),
        ]);
        listenersRef.current.set(session.id, () => {
          unlistenStatus();
          unlistenProgress();
        });

        return session;
      } catch (err) {
        pushError(
          err instanceof Error ? err.message : String(err),
          "create_session",
        );
        throw err;
      }
    },
    [repoRoot],
  );

  const deleteSession = useCallback(
    async (id: string, deleteBranch?: boolean) => {
      try {
        // The backend marks the session as "deleting" and emits
        // `session:deleted` once the worktree is fully removed. Don't
        // remove locally or refresh here — doing so would either flash the
        // session out-and-back-in (refresh sees it still on disk) or race
        // ahead of the actual filesystem deletion.
        await apiDeleteSession(id, deleteBranch);
      } catch (err) {
        pushError(
          err instanceof Error ? err.message : String(err),
          "delete_session",
        );
        throw err;
      }
    },
    [],
  );

  return {
    sessions,
    repoBranch,
    createSession,
    deleteSession,
    refresh,
  };
}
