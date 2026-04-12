import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  addOpenProject,
  addRecentProject,
  getLastRecentProject,
  getOpenProjects,
  getRecentProjectsState,
  removeOpenProject,
  removeRecentProject,
  setRecentProjectsState,
} from "./recentProjectsStore";

// Mock localStorage before importing the store
const mockStorage: Record<string, string> = {};
vi.stubGlobal("localStorage", {
  getItem: (key: string) => mockStorage[key] ?? null,
  setItem: (key: string, value: string) => {
    mockStorage[key] = value;
  },
  removeItem: (key: string) => {
    delete mockStorage[key];
  },
});

describe("recentProjectsStore", () => {
  beforeEach(() => {
    for (const key of Object.keys(mockStorage)) {
      delete mockStorage[key];
    }
    setRecentProjectsState({ projects: [], openProjects: [] });
  });

  describe("recent projects", () => {
    it("adds a project with extracted name", () => {
      addRecentProject("/home/user/Projects/MyApp");
      const projects = getRecentProjectsState().projects;
      expect(projects).toHaveLength(1);
      expect(projects[0].name).toBe("MyApp");
      expect(projects[0].path).toBe("/home/user/Projects/MyApp");
    });

    it("moves existing project to top on re-add", () => {
      addRecentProject("/a");
      addRecentProject("/b");
      addRecentProject("/a");
      const projects = getRecentProjectsState().projects;
      expect(projects).toHaveLength(2);
      expect(projects[0].path).toBe("/a");
    });

    it("limits to 10 projects", () => {
      for (let i = 0; i < 15; i++) {
        addRecentProject(`/project-${i}`);
      }

      expect(getRecentProjectsState().projects).toHaveLength(10);
    });

    it("removes a project", () => {
      addRecentProject("/a");
      removeRecentProject("/a");
      expect(getRecentProjectsState().projects).toHaveLength(0);
    });

    it("getLastProject returns most recent", () => {
      addRecentProject("/a");
      addRecentProject("/b");
      const last = getLastRecentProject();
      expect(last?.path).toBe("/b");
    });

    it("getLastProject returns null when empty", () => {
      expect(getLastRecentProject()).toBeNull();
    });

    it("persists to localStorage", () => {
      addRecentProject("/test");
      const stored = JSON.parse(
        mockStorage["stagehand:recentProjects"] ?? "[]",
      );
      expect(stored).toHaveLength(1);
      expect(stored[0].path).toBe("/test");
    });
  });

  describe("open projects", () => {
    it("adds an open project", () => {
      addOpenProject("/a");
      expect(getRecentProjectsState().openProjects).toHaveLength(1);
    });

    it("does not add duplicate open projects", () => {
      addOpenProject("/a");
      addOpenProject("/a");
      expect(getRecentProjectsState().openProjects).toHaveLength(1);
    });

    it("removes an open project", () => {
      addOpenProject("/a");
      removeOpenProject("/a");
      expect(getRecentProjectsState().openProjects).toHaveLength(0);
    });

    it("getOpenProjects returns current list", () => {
      addOpenProject("/a");
      addOpenProject("/b");
      const open = getOpenProjects();
      expect(open).toHaveLength(2);
    });

    it("persists to localStorage", () => {
      addOpenProject("/test");
      const stored = JSON.parse(mockStorage["stagehand:openProjects"] ?? "[]");
      expect(stored).toHaveLength(1);
    });
  });
});
