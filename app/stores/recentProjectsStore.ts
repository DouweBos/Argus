import { create } from "zustand";
import {
  LOCAL_HOST_ID,
  hostScopedKey,
  type HostId,
} from "../lib/transport/hostId";

const STORAGE_KEY = "argus:recentProjects";
const OPEN_PROJECTS_KEY = "argus:openProjects";
const MAX_PROJECTS = 10;

export interface RecentProject {
  /** Machine the path is on — `~/Work/app` on two hosts is two projects. */
  hostId: HostId;
  lastOpened: number;
  name: string;
  path: string;
}

export interface OpenProject {
  addedAt: number;
  hostId: HostId;
  path: string;
}

/** Entries written before hosts existed are this Mac's. */
function withHost<T extends { hostId?: HostId }>(
  entry: T,
): T & { hostId: HostId } {
  return { ...entry, hostId: entry.hostId ?? LOCAL_HOST_ID };
}

interface RecentProjectsStoreData {
  openProjects: OpenProject[];
  projects: RecentProject[];
}

function loadProjects(): RecentProject[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return [];
    }
    const parsed = JSON.parse(raw) as RecentProject[];

    return parsed.map(withHost).sort((a, b) => b.lastOpened - a.lastOpened);
  } catch {
    return [];
  }
}

function persistProjects(projects: RecentProject[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(projects));
}

function loadOpenProjects(): OpenProject[] {
  try {
    const raw = localStorage.getItem(OPEN_PROJECTS_KEY);
    if (!raw) {
      return [];
    }
    const parsed = JSON.parse(raw) as OpenProject[];

    return parsed.map(withHost);
  } catch {
    return [];
  }
}

function persistOpenProjects(projects: OpenProject[]) {
  localStorage.setItem(OPEN_PROJECTS_KEY, JSON.stringify(projects));
}

function basename(path: string): string {
  return path.split(/[/\\]/).filter(Boolean).pop() ?? path;
}

const recentProjectsStore = create<RecentProjectsStoreData>(() => ({
  projects: loadProjects(),
  openProjects: loadOpenProjects(),
}));

const useRecentProjectsStore = recentProjectsStore;

export const addRecentProject = (
  path: string,
  hostId: HostId = LOCAL_HOST_ID,
) => {
  recentProjectsStore.setState((state) => {
    const filtered = state.projects.filter(
      (p) => p.path !== path || p.hostId !== hostId,
    );
    const updated = [
      { path, hostId, name: basename(path), lastOpened: Date.now() },
      ...filtered,
    ].slice(0, MAX_PROJECTS);
    persistProjects(updated);

    return { projects: updated };
  });
};

export const removeRecentProject = (
  path: string,
  hostId: HostId = LOCAL_HOST_ID,
) => {
  recentProjectsStore.setState((state) => {
    const updated = state.projects.filter(
      (p) => p.path !== path || p.hostId !== hostId,
    );
    persistProjects(updated);

    return { projects: updated };
  });
};

export const getLastRecentProject = (): RecentProject | null => {
  const { projects } = recentProjectsStore.getState();

  return projects.length > 0 ? projects[0] : null;
};

export const addOpenProject = (
  path: string,
  hostId: HostId = LOCAL_HOST_ID,
) => {
  recentProjectsStore.setState((state) => {
    if (
      state.openProjects.some((p) => p.path === path && p.hostId === hostId)
    ) {
      return state;
    }
    const updated = [
      ...state.openProjects,
      { path, hostId, addedAt: Date.now() },
    ];
    persistOpenProjects(updated);

    return { openProjects: updated };
  });
};

export const removeOpenProject = (
  path: string,
  hostId: HostId = LOCAL_HOST_ID,
) => {
  recentProjectsStore.setState((state) => {
    const updated = state.openProjects.filter(
      (p) => p.path !== path || p.hostId !== hostId,
    );
    persistOpenProjects(updated);

    return { openProjects: updated };
  });
};

/** Reorder by `hostScopedKey(hostId, path)` — the same path on two hosts is two rows. */
export const reorderOpenProjects = (
  fromKey: string,
  toKey: string,
  position: "after" | "before",
) => {
  recentProjectsStore.setState((state) => {
    const keyOf = (p: OpenProject) => hostScopedKey(p.hostId, p.path);
    const fromIdx = state.openProjects.findIndex((p) => keyOf(p) === fromKey);
    const toIdx = state.openProjects.findIndex((p) => keyOf(p) === toKey);
    if (fromIdx === -1 || toIdx === -1 || fromKey === toKey) {
      return state;
    }
    const next = [...state.openProjects];
    const [moved] = next.splice(fromIdx, 1);
    const insertIdx = next.findIndex((p) => keyOf(p) === toKey);
    const anchor = position === "after" ? insertIdx + 1 : insertIdx;
    next.splice(anchor, 0, moved);
    persistOpenProjects(next);

    return { openProjects: next };
  });
};

export const getOpenProjects = (): OpenProject[] =>
  recentProjectsStore.getState().openProjects;

/** Forget everything a detached host contributed. */
export const dropHostProjects = (hostId: HostId) => {
  recentProjectsStore.setState((state) => {
    const openProjects = state.openProjects.filter((p) => p.hostId !== hostId);
    persistOpenProjects(openProjects);

    return { openProjects };
  });
};

export const useRecentProjects = () =>
  useRecentProjectsStore((s) => s.projects);

export const useOpenProjects = () =>
  useRecentProjectsStore((s) => s.openProjects);

/** For tests */
export const getRecentProjectsState = () => recentProjectsStore.getState();
export const setRecentProjectsState =
  recentProjectsStore.setState.bind(recentProjectsStore);
