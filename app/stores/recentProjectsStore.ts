import { create } from "zustand";

const STORAGE_KEY = "stagehand:recentProjects";
const OPEN_PROJECTS_KEY = "stagehand:openProjects";
const MAX_PROJECTS = 10;

export interface RecentProject {
  lastOpened: number;
  name: string;
  path: string;
}

export interface OpenProject {
  addedAt: number;
  path: string;
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

    return parsed.sort((a, b) => b.lastOpened - a.lastOpened);
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

    return parsed.sort((a, b) => a.addedAt - b.addedAt);
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

export const addRecentProject = (path: string) => {
  recentProjectsStore.setState((state) => {
    const filtered = state.projects.filter((p) => p.path !== path);
    const updated = [
      { path, name: basename(path), lastOpened: Date.now() },
      ...filtered,
    ].slice(0, MAX_PROJECTS);
    persistProjects(updated);

    return { projects: updated };
  });
};

export const removeRecentProject = (path: string) => {
  recentProjectsStore.setState((state) => {
    const updated = state.projects.filter((p) => p.path !== path);
    persistProjects(updated);

    return { projects: updated };
  });
};

export const getLastRecentProject = (): RecentProject | null => {
  const { projects } = recentProjectsStore.getState();

  return projects.length > 0 ? projects[0] : null;
};

export const addOpenProject = (path: string) => {
  recentProjectsStore.setState((state) => {
    if (state.openProjects.some((p) => p.path === path)) {
      return state;
    }
    const updated = [...state.openProjects, { path, addedAt: Date.now() }];
    persistOpenProjects(updated);

    return { openProjects: updated };
  });
};

export const removeOpenProject = (path: string) => {
  recentProjectsStore.setState((state) => {
    const updated = state.openProjects.filter((p) => p.path !== path);
    persistOpenProjects(updated);

    return { openProjects: updated };
  });
};

export const getOpenProjects = (): OpenProject[] =>
  recentProjectsStore.getState().openProjects;

export const useRecentProjects = () =>
  useRecentProjectsStore((s) => s.projects);

export const useOpenProjects = () =>
  useRecentProjectsStore((s) => s.openProjects);

/** For tests */
export const getRecentProjectsState = () => recentProjectsStore.getState();
export const setRecentProjectsState =
  recentProjectsStore.setState.bind(recentProjectsStore);
