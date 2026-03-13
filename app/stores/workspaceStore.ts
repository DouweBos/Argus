import { create } from "zustand";
import type { Workspace } from "../lib/types";
import { useTerminalStore } from "./terminalStore";

export interface Project {
  addedAt: number;
  isCollapsed: boolean;
  repoBranch: null | string;
  repoRoot: string;
}

interface WorkspaceState {
  addProject: (repoRoot: string) => void;
  addWorkspace: (workspace: Workspace) => void;
  error: null | string;
  isLoading: boolean;
  /** Merge backend workspaces for a specific project, preserving existing IDs when paths match. */
  mergeWorkspacesForProject: (
    repoRoot: string,
    workspaces: Workspace[],
  ) => void;
  projects: Project[];

  removeProject: (repoRoot: string) => void;
  removeWorkspace: (id: string) => void;
  selectedId: null | string;
  selectWorkspace: (id: null | string) => void;
  setError: (error: null | string) => void;
  setLoading: (loading: boolean) => void;
  setProjectBranch: (repoRoot: string, branch: null | string) => void;
  setSetupProgress: (
    workspaceId: string,
    progress: { current: number; item: string; total: number } | null,
  ) => void;
  /** Current item and progress during setup. Cleared when setup completes. */
  setupProgressByWorkspaceId: Record<
    string,
    { current: number; item: string; total: number }
  >;
  setWorkspaces: (workspaces: Workspace[]) => void;
  toggleProjectCollapsed: (repoRoot: string) => void;
  updateWorkspace: (id: string, patch: Partial<Workspace>) => void;
  workspaces: Workspace[];
}

export const useWorkspaceStore = create<WorkspaceState>((set) => ({
  projects: [],
  workspaces: [],
  selectedId: null,
  isLoading: false,
  error: null,
  setupProgressByWorkspaceId: {},

  addProject: (repoRoot) =>
    set((state) => {
      if (state.projects.some((p) => p.repoRoot === repoRoot)) return state;
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
    }),

  removeProject: (repoRoot) =>
    set((state) => {
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
    }),

  setProjectBranch: (repoRoot, branch) =>
    set((state) => ({
      projects: state.projects.map((p) =>
        p.repoRoot === repoRoot ? { ...p, repoBranch: branch } : p,
      ),
    })),

  toggleProjectCollapsed: (repoRoot) =>
    set((state) => ({
      projects: state.projects.map((p) =>
        p.repoRoot === repoRoot ? { ...p, isCollapsed: !p.isCollapsed } : p,
      ),
    })),

  setWorkspaces: (workspaces) => set({ workspaces }),

  mergeWorkspacesForProject: (repoRoot, incoming) =>
    set((state) => {
      const normalizePath = (p: string) =>
        p.replace(/\\/g, "/").replace(/\/+$/, "").replace(/\/+/g, "/");

      // Existing workspaces for this project
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

      // Migrate orphaned terminal sessions
      const mergedIds = new Set(merged.map((w) => w.id));
      const mergedByPath = new Map(
        merged.map((w) => [normalizePath(w.path), w]),
      );
      for (const oldWs of existing) {
        if (mergedIds.has(oldWs.id)) continue;
        const newWs = mergedByPath.get(normalizePath(oldWs.path));
        if (newWs && newWs.id !== oldWs.id) {
          useTerminalStore.getState().migrateSessions(oldWs.id, newWs.id);
        }
      }

      // Replace this project's workspaces, keep others untouched
      const otherWorkspaces = state.workspaces.filter(
        (w) => w.repo_root !== repoRoot,
      );
      return { workspaces: [...otherWorkspaces, ...merged] };
    }),

  addWorkspace: (workspace) =>
    set((state) => ({ workspaces: [...state.workspaces, workspace] })),

  removeWorkspace: (id) =>
    set((state) => ({
      workspaces: state.workspaces.filter((w) => w.id !== id),
      selectedId: state.selectedId === id ? null : state.selectedId,
    })),

  updateWorkspace: (id, patch) =>
    set((state) => ({
      workspaces: state.workspaces.map((w) =>
        w.id === id ? { ...w, ...patch } : w,
      ),
    })),

  selectWorkspace: (id) => set({ selectedId: id }),

  setLoading: (isLoading) => set({ isLoading }),

  setError: (error) => set({ error }),

  setSetupProgress: (workspaceId, progress) =>
    set((state) => {
      const next = { ...state.setupProgressByWorkspaceId };
      if (progress == null) {
        delete next[workspaceId];
      } else {
        next[workspaceId] = progress;
      }
      return { setupProgressByWorkspaceId: next };
    }),
}));
