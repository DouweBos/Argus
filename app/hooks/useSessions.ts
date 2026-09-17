import type { CreateSessionLlm } from "../lib/ipc";
import type { HostId } from "../lib/transport/hostId";
import type { Session } from "../lib/types";
import { useCallback, useEffect, useMemo, useRef } from "react";
import { listen } from "../lib/events";
import { listSessions } from "../lib/ipc";
import {
  closeProject as closeProjectService,
  createSessionInProject,
  deleteSessionById,
  openProject as openProjectService,
} from "../lib/projectsService";
import { refreshRepoBranch } from "../lib/repoBranchSync";
import { startListening } from "../lib/terminalBufferService";
import { LOCAL_HOST_ID } from "../lib/transport/hostId";
import {
  getSessionState,
  mergeSessionsForProject,
  selectSession,
  setProjectBranch,
  setSetupProgress,
  updateSession,
  useSelectedSessionId,
  useSessionLoading,
  sessionHostId,
  useSessionProjects,
  useSessions,
} from "../stores/sessionStore";
import {
  addSession as addTerminalSession,
  getSessionsForSession as getTerminalsForSession,
} from "../stores/terminalStore";
import { isWindowFocused } from "./useWindowFocus";

// ---------------------------------------------------------------------------
// Shared event-listener helpers
// ---------------------------------------------------------------------------

function setupSessionStatusListener(sessionId: string): Promise<() => void> {
  return listen<string>(`session:status:${sessionId}`, (event) => {
    const payload = event.payload;
    let status: Session["status"];
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

function setupSessionTerminalListener(sessionId: string): Promise<() => void> {
  return listen<{ terminalId: string; title: string }>(
    `session:setup_terminal:${sessionId}`,
    (event) => {
      const { terminalId, title } = event.payload;
      const existing = getTerminalsForSession(sessionId);
      if (existing.some((t) => t.id === terminalId)) {
        return;
      }
      startListening(terminalId);
      addTerminalSession({
        id: terminalId,
        session_id: sessionId,
        title: title || "Setup",
      });
    },
  );
}

function setupSessionProgressListener(sessionId: string): Promise<() => void> {
  return listen<{
    current: number;
    item: string;
    phase?: "command" | "copy" | "matching" | "symlink";
    total: number;
  }>(`session:setup_progress:${sessionId}`, (event) => {
    const data = event.payload;
    if (
      data &&
      typeof data.item === "string" &&
      typeof data.current === "number" &&
      typeof data.total === "number"
    ) {
      setSetupProgress(sessionId, data);
    }
  });
}

// ---------------------------------------------------------------------------
// useProjects — selectors + stable mutator references
// ---------------------------------------------------------------------------

export function useProjects() {
  const projects = useSessionProjects();
  const selectedId = useSelectedSessionId();
  const isLoading = useSessionLoading();

  return {
    projects,
    selectedId,
    selectSession,
    openProject: openProjectService,
    closeProject: closeProjectService,
    isLoading,
  };
}

// ---------------------------------------------------------------------------
// useProjectSessions — per-project hook for session management
// ---------------------------------------------------------------------------

export function useProjectSessions(
  repoRoot: string,
  hostId: HostId = LOCAL_HOST_ID,
) {
  const allSessions = useSessions();
  const allProjects = useSessionProjects();
  const listenersRef = useRef<Map<string, () => void>>(new Map());

  // Two hosts can hold this path; only the sessions belonging to this one.
  const sessions = useMemo(
    () =>
      allSessions.filter(
        (w) => w.repo_root === repoRoot && sessionHostId(w.id) === hostId,
      ),
    [allSessions, repoRoot, hostId],
  );
  const project = useMemo(
    () =>
      allProjects.find((p) => p.repoRoot === repoRoot && p.hostId === hostId),
    [allProjects, repoRoot, hostId],
  );
  const repoBranch = project?.repoBranch ?? null;

  const refresh = useCallback(async () => {
    try {
      const ws = await listSessions(repoRoot);
      mergeSessionsForProject(repoRoot, ws, hostId);
      refreshRepoBranch(repoRoot, hostId).catch(() => {});
    } catch {
      // Ignore refresh errors
    }
  }, [repoRoot, hostId]);

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
        mergeSessionsForProject(repoRoot, ws, hostId);
      } catch {
        // Ignore poll errors
      }
    }, 500);

    return () => clearInterval(interval);
  }, [hasInitializing, repoRoot, hostId]);

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
        setProjectBranch(repoRoot, branch, hostId);
        updateSession(repoRootId, { branch });
      },
      { hostId },
    );

    return () => {
      unlisten.then((fn) => fn());
    };
  }, [repoRootId, repoRoot, hostId]);

  const sessionIds = sessions
    .map((w) => w.id)
    .sort()
    .join(",");
  useEffect(() => {
    const currentSessions = getSessionState().sessions.filter(
      (w) => w.repo_root === repoRoot && sessionHostId(w.id) === hostId,
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
          setupSessionTerminalListener(id),
        ]).then(([unlistenStatus, unlistenProgress, unlistenTerminal]) => {
          listenersRef.current.set(id, () => {
            unlistenStatus();
            unlistenProgress();
            unlistenTerminal();
          });
        });
      }
    }
  }, [sessionIds, repoRoot, hostId]);

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
      llm?: CreateSessionLlm,
    ) => {
      const session = await createSessionInProject(
        repoRoot,
        branch,
        description,
        useExistingBranch,
        baseBranch,
        llm,
      );

      const [unlistenStatus, unlistenProgress, unlistenTerminal] =
        await Promise.all([
          setupSessionStatusListener(session.id),
          setupSessionProgressListener(session.id),
          setupSessionTerminalListener(session.id),
        ]);
      listenersRef.current.set(session.id, () => {
        unlistenStatus();
        unlistenProgress();
        unlistenTerminal();
      });

      return session;
    },
    [repoRoot],
  );

  const deleteSession = useCallback(
    async (id: string, deleteBranch?: boolean) => {
      await deleteSessionById(id, deleteBranch);
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
