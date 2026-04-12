import type { Workspace } from "../lib/types";
import { create } from "zustand";
import { migrateSessions } from "./terminalStore";

export interface Project {
  addedAt: number;
  isCollapsed: boolean;
  repoBranch: string | null;
  repoRoot: string;
}

interface WorkspaceStoreData {
  error: string | null;
  isLoading: boolean;
  projects: Project[];
  selectedId: string | null;
  /** Current item and progress during setup. Cleared when setup completes. */
  setupProgressByWorkspaceId: Record<
    string,
    { current: number; item: string; total: number }
  >;
  workspaces: Workspace[];
}

const workspaceStore = create<WorkspaceStoreData>(() => ({
  projects: [],
  workspaces: [],
  selectedId: null,
  isLoading: false,
  error: null,
  setupProgressByWorkspaceId: {},
}));

const useWorkspaceStore = workspaceStore;

export const addProject = (repoRoot: string) => {
  workspaceStore.setState((state) => {
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
  workspaceStore.setState((state) => {
    const wsIds = state.workspaces
      .filter((w) => w.repo_root === repoRoot)
      .map((w) => w.id);
    const selectedGone =
      state.selectedId != null && wsIds.includes(state.selectedId);

    return {
      projects: state.projects.filter((p) => p.repoRoot !== repoRoot),
      workspaces: state.workspaces.filter((w) => w.repo_root !== repoRoot),
      selectedId: selectedGone ? null : state.selectedId,
    };
  });
};

export const setProjectBranch = (repoRoot: string, branch: string | null) => {
  workspaceStore.setState((state) => ({
    projects: state.projects.map((p) =>
      p.repoRoot === repoRoot ? { ...p, repoBranch: branch } : p,
    ),
  }));
};

export const toggleProjectCollapsed = (repoRoot: string) => {
  workspaceStore.setState((state) => ({
    projects: state.projects.map((p) =>
      p.repoRoot === repoRoot ? { ...p, isCollapsed: !p.isCollapsed } : p,
    ),
  }));
};

export const setWorkspaces = (workspaces: Workspace[]) => {
  workspaceStore.setState({ workspaces });
};

export const mergeWorkspacesForProject = (
  repoRoot: string,
  incoming: Workspace[],
) => {
  workspaceStore.setState((state) => {
    const normalizePath = (p: string) =>
      p.replace(/\\/g, "/").replace(/\/+$/, "").replace(/\/+/g, "/");

    const existing = state.workspaces.filter((w) => w.repo_root === repoRoot);
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

    const otherWorkspaces = state.workspaces.filter(
      (w) => w.repo_root !== repoRoot,
    );

    return { workspaces: [...otherWorkspaces, ...merged] };
  });
};

export const addWorkspace = (workspace: Workspace) => {
  workspaceStore.setState((state) => ({
    workspaces: [...state.workspaces, workspace],
  }));
};

export const removeWorkspace = (id: string) => {
  workspaceStore.setState((state) => ({
    workspaces: state.workspaces.filter((w) => w.id !== id),
    selectedId: state.selectedId === id ? null : state.selectedId,
  }));
};

export const updateWorkspace = (id: string, patch: Partial<Workspace>) => {
  workspaceStore.setState((state) => ({
    workspaces: state.workspaces.map((w) =>
      w.id === id ? { ...w, ...patch } : w,
    ),
  }));
};

export const selectWorkspace = (id: string | null) => {
  workspaceStore.setState({ selectedId: id });
};

export const setLoading = (isLoading: boolean) => {
  workspaceStore.setState({ isLoading });
};

export const setError = (error: string | null) => {
  workspaceStore.setState({ error });
};

export const setSetupProgress = (
  workspaceId: string,
  progress: { current: number; item: string; total: number } | null,
) => {
  workspaceStore.setState((state) => {
    const next = { ...state.setupProgressByWorkspaceId };
    if (progress == null) {
      delete next[workspaceId];
    } else {
      next[workspaceId] = progress;
    }

    return { setupProgressByWorkspaceId: next };
  });
};

export const useWorkspaceProjects = () => useWorkspaceStore((s) => s.projects);

export const useSelectedWorkspaceId = () =>
  useWorkspaceStore((s) => s.selectedId);

export const useWorkspaceError = () => useWorkspaceStore((s) => s.error);

export const useWorkspaceLoading = () => useWorkspaceStore((s) => s.isLoading);

export const useWorkspaces = () => useWorkspaceStore((s) => s.workspaces);

export const useSetupProgressByWorkspaceId = () =>
  useWorkspaceStore((s) => s.setupProgressByWorkspaceId);

/** For tests */
export const getWorkspaceState = () => workspaceStore.getState();
export const setWorkspaceState = workspaceStore.setState.bind(workspaceStore);
