import { describe, expect, it, beforeEach, vi } from "vitest";

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

// Import after mocking
import { useRecentProjectsStore } from "./recentProjectsStore";

describe("recentProjectsStore", () => {
  beforeEach(() => {
    for (const key of Object.keys(mockStorage)) delete mockStorage[key];
    useRecentProjectsStore.setState({ projects: [], openProjects: [] });
  });

  describe("recent projects", () => {
    it("adds a project with extracted name", () => {
      useRecentProjectsStore.getState().addProject("/home/user/Projects/MyApp");
      const projects = useRecentProjectsStore.getState().projects;
      expect(projects).toHaveLength(1);
      expect(projects[0].name).toBe("MyApp");
      expect(projects[0].path).toBe("/home/user/Projects/MyApp");
    });

    it("moves existing project to top on re-add", () => {
      useRecentProjectsStore.getState().addProject("/a");
      useRecentProjectsStore.getState().addProject("/b");
      useRecentProjectsStore.getState().addProject("/a");
      const projects = useRecentProjectsStore.getState().projects;
      expect(projects).toHaveLength(2);
      expect(projects[0].path).toBe("/a");
    });

    it("limits to 10 projects", () => {
      for (let i = 0; i < 15; i++) {
        useRecentProjectsStore.getState().addProject(`/project-${i}`);
      }
      expect(useRecentProjectsStore.getState().projects).toHaveLength(10);
    });

    it("removes a project", () => {
      useRecentProjectsStore.getState().addProject("/a");
      useRecentProjectsStore.getState().removeProject("/a");
      expect(useRecentProjectsStore.getState().projects).toHaveLength(0);
    });

    it("getLastProject returns most recent", () => {
      useRecentProjectsStore.getState().addProject("/a");
      useRecentProjectsStore.getState().addProject("/b");
      const last = useRecentProjectsStore.getState().getLastProject();
      expect(last?.path).toBe("/b");
    });

    it("getLastProject returns null when empty", () => {
      expect(useRecentProjectsStore.getState().getLastProject()).toBeNull();
    });

    it("persists to localStorage", () => {
      useRecentProjectsStore.getState().addProject("/test");
      const stored = JSON.parse(
        mockStorage["stagehand:recentProjects"] ?? "[]",
      );
      expect(stored).toHaveLength(1);
      expect(stored[0].path).toBe("/test");
    });
  });

  describe("open projects", () => {
    it("adds an open project", () => {
      useRecentProjectsStore.getState().addOpenProject("/a");
      expect(useRecentProjectsStore.getState().openProjects).toHaveLength(1);
    });

    it("does not add duplicate open projects", () => {
      useRecentProjectsStore.getState().addOpenProject("/a");
      useRecentProjectsStore.getState().addOpenProject("/a");
      expect(useRecentProjectsStore.getState().openProjects).toHaveLength(1);
    });

    it("removes an open project", () => {
      useRecentProjectsStore.getState().addOpenProject("/a");
      useRecentProjectsStore.getState().removeOpenProject("/a");
      expect(useRecentProjectsStore.getState().openProjects).toHaveLength(0);
    });

    it("getOpenProjects returns current list", () => {
      useRecentProjectsStore.getState().addOpenProject("/a");
      useRecentProjectsStore.getState().addOpenProject("/b");
      const open = useRecentProjectsStore.getState().getOpenProjects();
      expect(open).toHaveLength(2);
    });

    it("persists to localStorage", () => {
      useRecentProjectsStore.getState().addOpenProject("/test");
      const stored = JSON.parse(mockStorage["stagehand:openProjects"] ?? "[]");
      expect(stored).toHaveLength(1);
    });
  });
});
