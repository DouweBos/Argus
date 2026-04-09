import { useCallback, useEffect, useRef } from "react";
import { listen } from "../lib/events";
import { useWorkspaceStore } from "../stores/workspaceStore";
import { useRecentProjectsStore } from "../stores/recentProjectsStore";
import {
  listWorkspaces,
  getRepoBranch,
  createWorkspace as apiCreateWorkspace,
  createHeadWorkspace as apiCreateHeadWorkspace,
  deleteWorkspace as apiDeleteWorkspace,
  addRepoRoot as apiAddRepoRoot,
  removeRepoRoot as apiRemoveRepoRoot,
} from "../lib/ipc";
import { isWindowFocused } from "./useWindowFocus";

// ---------------------------------------------------------------------------
// Shared event-listener helpers
// ---------------------------------------------------------------------------

function setupWorkspaceStatusListener(
  workspaceId: string,
): Promise<() => void> {
  return listen<string>(`workspace:status:${workspaceId}`, (event) => {
    const payload = event.payload;
    let status: "initializing" | "ready" | { error: string };
    if (payload === "ready") {
      status = "ready";
      useWorkspaceStore.getState().setSetupProgress(workspaceId, null);
    } else if (payload.startsWith("error:")) {
      status = { error: payload.slice(6) };
      useWorkspaceStore.getState().setSetupProgress(workspaceId, null);
    } else {
      status = "initializing";
    }
    useWorkspaceStore.getState().updateWorkspace(workspaceId, { status });
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
        useWorkspaceStore.getState().setSetupProgress(workspaceId, data);
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
  // Select only the reactive data we expose to callers — avoids subscribing
  // to the entire store which would make every useCallback unstable.
  const projects = useWorkspaceStore((s) => s.projects);
  const selectedId = useWorkspaceStore((s) => s.selectedId);
  const error = useWorkspaceStore((s) => s.error);
  const isLoading = useWorkspaceStore((s) => s.isLoading);

  const {
    addOpenProject,
    removeOpenProject,
    getOpenProjects,
    addProject: addRecentProject,
  } = useRecentProjectsStore();

  const openProject = useCallback(
    async (
      path: string,
      options?: { autoSelect?: boolean; skipRecent?: boolean },
    ) => {
      const ws = useWorkspaceStore.getState();
      ws.setError(null);
      try {
        await apiAddRepoRoot(path);
        ws.addProject(path);

        // Create the HEAD workspace for this project
        await apiCreateHeadWorkspace(path);

        // Fetch workspaces for this project
        const workspaces = await listWorkspaces(path);
        useWorkspaceStore
          .getState()
          .mergeWorkspacesForProject(path, workspaces);

        // Fetch branch
        try {
          const branch = await getRepoBranch(path);
          useWorkspaceStore.getState().setProjectBranch(path, branch);
        } catch {
          useWorkspaceStore.getState().setProjectBranch(path, null);
        }

        // Auto-select the first workspace when user explicitly opens (not on app restore)
        const shouldAutoSelect = options?.autoSelect !== false;
        const projectWorkspaces = useWorkspaceStore
          .getState()
          .workspaces.filter((w) => w.repo_root === path);
        if (
          shouldAutoSelect &&
          projectWorkspaces.length > 0 &&
          useWorkspaceStore.getState().selectedId === null
        ) {
          useWorkspaceStore.getState().selectWorkspace(projectWorkspaces[0].id);
        }

        if (!options?.skipRecent) addRecentProject(path);
        addOpenProject(path);
      } catch (err) {
        useWorkspaceStore
          .getState()
          .setError(err instanceof Error ? err.message : String(err));
        throw err;
      }
    },
    [addRecentProject, addOpenProject],
  );

  const closeProject = useCallback(
    async (repoRoot: string) => {
      useWorkspaceStore.getState().setError(null);
      try {
        await apiRemoveRepoRoot(repoRoot);
        useWorkspaceStore.getState().removeProject(repoRoot);
        removeOpenProject(repoRoot);
      } catch (err) {
        useWorkspaceStore
          .getState()
          .setError(err instanceof Error ? err.message : String(err));
      }
    },
    [removeOpenProject],
  );

  // On mount: reopen all previously open projects (do not auto-select; user lands on Home)
  useEffect(() => {
    const open = getOpenProjects();
    if (open.length > 0) {
      // Open them in order (sorted by addedAt ascending)
      const sorted = [...open].sort((a, b) => a.addedAt - b.addedAt);
      (async () => {
        for (const p of sorted) {
          try {
            await openProject(p.path, { autoSelect: false, skipRecent: true });
          } catch {
            // Directory may have been deleted — remove stale entry
            removeOpenProject(p.path);
          }
        }
      })();
    }
  }, [getOpenProjects, openProject, removeOpenProject]);

  // Listen for background delete failures
  useEffect(() => {
    const unlisten = listen<{ error: string; id: string }>(
      "workspace:delete-failed",
      (event) => {
        const { error } = event.payload;
        useWorkspaceStore
          .getState()
          .setError(`Failed to delete workspace: ${error}`);
      },
    );
    return () => {
      unlisten.then((fn) => fn());
    };
  }, []);

  return {
    projects,
    selectedId,
    selectWorkspace: useWorkspaceStore.getState().selectWorkspace,
    openProject,
    closeProject,
    error,
    isLoading,
  };
}

// ---------------------------------------------------------------------------
// useProjectWorkspaces — per-project hook for workspace management
// ---------------------------------------------------------------------------

export function useProjectWorkspaces(repoRoot: string) {
  const store = useWorkspaceStore();
  const listenersRef = useRef<Map<string, () => void>>(new Map());

  const workspaces = store.workspaces.filter((w) => w.repo_root === repoRoot);
  const project = store.projects.find((p) => p.repoRoot === repoRoot);
  const repoBranch = project?.repoBranch ?? null;

  const refresh = useCallback(async () => {
    try {
      const ws = await listWorkspaces(repoRoot);
      useWorkspaceStore.getState().mergeWorkspacesForProject(repoRoot, ws);
      try {
        const branch = await getRepoBranch(repoRoot);
        useWorkspaceStore.getState().setProjectBranch(repoRoot, branch);
      } catch {
        useWorkspaceStore.getState().setProjectBranch(repoRoot, null);
      }
    } catch {
      // Ignore refresh errors
    }
  }, [repoRoot]);

  // Poll for workspace status when any are initializing
  const hasInitializing = workspaces.some((w) => w.status === "initializing");
  useEffect(() => {
    if (!hasInitializing) return;
    const interval = setInterval(async () => {
      if (!isWindowFocused()) return;
      try {
        const ws = await listWorkspaces(repoRoot);
        useWorkspaceStore.getState().mergeWorkspacesForProject(repoRoot, ws);
      } catch {
        // Ignore poll errors
      }
    }, 500);
    return () => clearInterval(interval);
  }, [hasInitializing, repoRoot]);

  // Listen for branch changes pushed from the backend (fs.watch on .git/HEAD).
  const repoRootWorkspace = workspaces.find((w) => w.kind === "repo_root");
  const repoRootId = repoRootWorkspace?.id ?? null;
  useEffect(() => {
    if (!repoRootId) return;
    const unlisten = listen<{ branch: string }>(
      `workspace:branch-changed:${repoRootId}`,
      (event) => {
        const { branch } = event.payload;
        const state = useWorkspaceStore.getState();
        state.setProjectBranch(repoRoot, branch);
        state.updateWorkspace(repoRootId, { branch });
      },
    );
    return () => {
      unlisten.then((fn) => fn());
    };
  }, [repoRootId, repoRoot]);

  // Manage event listeners for workspace status/progress
  const workspaceIds = workspaces
    .map((w) => w.id)
    .sort()
    .join(",");
  useEffect(() => {
    const currentWorkspaces = useWorkspaceStore
      .getState()
      .workspaces.filter((w) => w.repo_root === repoRoot);
    const currentIds = new Set(currentWorkspaces.map((w) => w.id));

    // Remove listeners for workspaces no longer in the list
    const toRemove: string[] = [];
    for (const [id] of listenersRef.current) {
      if (!currentIds.has(id)) toRemove.push(id);
    }
    for (const id of toRemove) {
      listenersRef.current.get(id)?.();
      listenersRef.current.delete(id);
    }

    // Add listeners for new workspaces
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

  // Clean up listeners on unmount
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
    ) => {
      useWorkspaceStore.getState().setError(null);
      try {
        const workspace = await apiCreateWorkspace(
          repoRoot,
          branch,
          description,
          useExistingBranch,
        );
        useWorkspaceStore.getState().addWorkspace(workspace);
        useWorkspaceStore.getState().selectWorkspace(workspace.id);

        // Register listeners immediately
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
        useWorkspaceStore
          .getState()
          .setError(err instanceof Error ? err.message : String(err));
        throw err;
      }
    },
    [repoRoot],
  );

  const deleteWorkspace = useCallback(
    async (id: string, deleteBranch?: boolean) => {
      useWorkspaceStore.getState().setError(null);
      try {
        await apiDeleteWorkspace(id, deleteBranch);
        useWorkspaceStore.getState().removeWorkspace(id);
      } catch (err) {
        useWorkspaceStore
          .getState()
          .setError(err instanceof Error ? err.message : String(err));
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
