import type { Workspace } from "../lib/types";
import { useCallback, useEffect, useMemo, useRef } from "react";
import { stopAgentListening } from "../lib/agentEventService";
import { listen } from "../lib/events";
import {
  addRepoRoot as apiAddRepoRoot,
  createHeadWorkspace as apiCreateHeadWorkspace,
  createWorkspace as apiCreateWorkspace,
  deleteWorkspace as apiDeleteWorkspace,
  removeRepoRoot as apiRemoveRepoRoot,
  getRepoBranch,
  listWorkspaces,
} from "../lib/ipc";
import { seedReviewStateForWorkspace } from "../lib/reviewQueueService";
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
  addWorkspace,
  getWorkspaceState,
  mergeWorkspacesForProject,
  removeProject,
  removeWorkspace,
  selectWorkspace,
  setProjectBranch,
  setSetupProgress,
  updateWorkspace,
  useSelectedWorkspaceId,
  useWorkspaceLoading,
  useWorkspaceProjects,
  useWorkspaces,
} from "../stores/workspaceStore";
import { isWindowFocused } from "./useWindowFocus";

// ---------------------------------------------------------------------------
// Shared event-listener helpers
// ---------------------------------------------------------------------------

function setupWorkspaceStatusListener(
  workspaceId: string,
): Promise<() => void> {
  return listen<string>(`workspace:status:${workspaceId}`, (event) => {
    const payload = event.payload;
    let status: "deleting" | "initializing" | "ready" | { error: string };
    if (payload === "ready") {
      status = "ready";
      setSetupProgress(workspaceId, null);
    } else if (payload === "deleting") {
      status = "deleting";
      setSetupProgress(workspaceId, null);
    } else if (payload.startsWith("error:")) {
      status = { error: payload.slice(6) };
      // Keep the last setup progress so the UI can show which step failed.
    } else {
      status = "initializing";
    }

    updateWorkspace(workspaceId, { status });
  });
}

function setupWorkspaceProgressListener(
  workspaceId: string,
): Promise<() => void> {
  return listen<string>(`workspace:setup_progress:${workspaceId}`, (event) => {
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
        setSetupProgress(workspaceId, data);
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
  const projects = useWorkspaceProjects();
  const selectedId = useSelectedWorkspaceId();
  const isLoading = useWorkspaceLoading();

  const openProject = useCallback(
    async (
      path: string,
      options?: { autoSelect?: boolean; skipRecent?: boolean },
    ) => {
      try {
        await apiAddRepoRoot(path);
        addProject(path);

        await apiCreateHeadWorkspace(path);

        const workspaces = await listWorkspaces(path);
        mergeWorkspacesForProject(path, workspaces);

        // Seed the review queue with the current commits-ahead count for each
        // worktree — worktrees may have accumulated changes in a previous
        // session. repo_root workspaces are skipped upstream in the backend.
        for (const ws of workspaces) {
          if (ws.kind === "worktree") {
            seedReviewStateForWorkspace(ws.id).catch(() => {});
          }
        }

        try {
          const branch = await getRepoBranch(path);
          setProjectBranch(path, branch);
        } catch {
          setProjectBranch(path, null);
        }

        const shouldAutoSelect = options?.autoSelect !== false;
        const projectWorkspaces = getWorkspaceState().workspaces.filter(
          (w) => w.repo_root === path,
        );
        if (
          shouldAutoSelect &&
          projectWorkspaces.length > 0 &&
          getWorkspaceState().selectedId === null
        ) {
          const repoRootWs = projectWorkspaces.find(
            (w) => w.kind === "repo_root",
          );
          selectWorkspace((repoRootWs ?? projectWorkspaces[0]).id);
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
      "workspace:delete-failed",
      (event) => {
        const { error: message } = event.payload;
        pushError(`Failed to delete workspace: ${message}`, "delete_workspace");
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
    const unlisten = listen<Workspace>("workspace:created", (event) => {
      const ws = event.payload;
      if (!getWorkspaceState().workspaces.some((w) => w.id === ws.id)) {
        addWorkspace(ws);
      }
      if (ws.kind === "worktree") {
        seedReviewStateForWorkspace(ws.id).catch(() => {});
      }
    });

    return () => {
      unlisten.then((fn) => fn());
    };
  }, []);

  useEffect(() => {
    const unlisten = listen<{ display_name?: string | null; id: string }>(
      "workspace:updated",
      (event) => {
        const { id, display_name } = event.payload;
        if (!getWorkspaceState().workspaces.some((w) => w.id === id)) {
          return;
        }
        updateWorkspace(id, { display_name: display_name ?? null });
      },
    );

    return () => {
      unlisten.then((fn) => fn());
    };
  }, []);

  useEffect(() => {
    const unlisten = listen<string>("workspace:deleted", (event) => {
      const wsId = event.payload;
      // Purge any agents tracked for this workspace — the backend has
      // already killed their processes, but the renderer store would
      // otherwise keep showing them indefinitely.
      const agents = getAgentState().agents;
      for (const agent of Object.values(agents)) {
        if (agent.workspace_id === wsId) {
          stopAgentListening(agent.agent_id);
          removeAgent(agent.agent_id);
        }
      }
      if (getWorkspaceState().workspaces.some((w) => w.id === wsId)) {
        removeWorkspace(wsId);
      }
    });

    return () => {
      unlisten.then((fn) => fn());
    };
  }, []);

  return {
    projects,
    selectedId,
    selectWorkspace,
    openProject,
    closeProject,
    isLoading,
  };
}

// ---------------------------------------------------------------------------
// useProjectWorkspaces — per-project hook for workspace management
// ---------------------------------------------------------------------------

export function useProjectWorkspaces(repoRoot: string) {
  const allWorkspaces = useWorkspaces();
  const allProjects = useWorkspaceProjects();
  const listenersRef = useRef<Map<string, () => void>>(new Map());

  const workspaces = useMemo(
    () => allWorkspaces.filter((w) => w.repo_root === repoRoot),
    [allWorkspaces, repoRoot],
  );
  const project = useMemo(
    () => allProjects.find((p) => p.repoRoot === repoRoot),
    [allProjects, repoRoot],
  );
  const repoBranch = project?.repoBranch ?? null;

  const refresh = useCallback(async () => {
    try {
      const ws = await listWorkspaces(repoRoot);
      mergeWorkspacesForProject(repoRoot, ws);
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

  const hasInitializing = workspaces.some((w) => w.status === "initializing");
  useEffect(() => {
    if (!hasInitializing) {
      return;
    }
    const interval = setInterval(async () => {
      if (!isWindowFocused()) {
        return;
      }
      try {
        const ws = await listWorkspaces(repoRoot);
        mergeWorkspacesForProject(repoRoot, ws);
      } catch {
        // Ignore poll errors
      }
    }, 500);

    return () => clearInterval(interval);
  }, [hasInitializing, repoRoot]);

  const repoRootWorkspace = workspaces.find((w) => w.kind === "repo_root");
  const repoRootId = repoRootWorkspace?.id ?? null;
  useEffect(() => {
    if (!repoRootId) {
      return;
    }
    const unlisten = listen<{ branch: string }>(
      `workspace:branch-changed:${repoRootId}`,
      (event) => {
        const { branch } = event.payload;
        setProjectBranch(repoRoot, branch);
        updateWorkspace(repoRootId, { branch });
      },
    );

    return () => {
      unlisten.then((fn) => fn());
    };
  }, [repoRootId, repoRoot]);

  const workspaceIds = workspaces
    .map((w) => w.id)
    .sort()
    .join(",");
  useEffect(() => {
    const currentWorkspaces = getWorkspaceState().workspaces.filter(
      (w) => w.repo_root === repoRoot,
    );
    const currentIds = new Set(currentWorkspaces.map((w) => w.id));

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

    for (const ws of currentWorkspaces) {
      if (!listenersRef.current.has(ws.id)) {
        const id = ws.id;
        Promise.all([
          setupWorkspaceStatusListener(id),
          setupWorkspaceProgressListener(id),
        ]).then(([unlistenStatus, unlistenProgress]) => {
          listenersRef.current.set(id, () => {
            unlistenStatus();
            unlistenProgress();
          });
        });
      }
    }
  }, [workspaceIds, repoRoot]);

  useEffect(() => {
    const listeners = listenersRef.current;

    return () => {
      listeners.forEach((unlisten) => unlisten());
      listeners.clear();
    };
  }, []);

  const createWorkspace = useCallback(
    async (
      branch: string,
      description: string,
      useExistingBranch?: boolean,
      baseBranch?: string,
    ) => {
      try {
        const workspace = await apiCreateWorkspace(
          repoRoot,
          branch,
          description,
          useExistingBranch,
          baseBranch,
        );
        addWorkspace(workspace);
        selectWorkspace(workspace.id);

        const [unlistenStatus, unlistenProgress] = await Promise.all([
          setupWorkspaceStatusListener(workspace.id),
          setupWorkspaceProgressListener(workspace.id),
        ]);
        listenersRef.current.set(workspace.id, () => {
          unlistenStatus();
          unlistenProgress();
        });

        return workspace;
      } catch (err) {
        pushError(
          err instanceof Error ? err.message : String(err),
          "create_workspace",
        );
        throw err;
      }
    },
    [repoRoot],
  );

  const deleteWorkspace = useCallback(
    async (id: string, deleteBranch?: boolean) => {
      try {
        // The backend marks the workspace as "deleting" and emits
        // `workspace:deleted` once the worktree is fully removed. Don't
        // remove locally or refresh here — doing so would either flash the
        // workspace out-and-back-in (refresh sees it still on disk) or race
        // ahead of the actual filesystem deletion.
        await apiDeleteWorkspace(id, deleteBranch);
      } catch (err) {
        pushError(
          err instanceof Error ? err.message : String(err),
          "delete_workspace",
        );
        throw err;
      }
    },
    [],
  );

  return {
    workspaces,
    repoBranch,
    createWorkspace,
    deleteWorkspace,
    refresh,
  };
}
