import type { Project } from "./workspaceStore";
import type { Workspace } from "../lib/types";
import { beforeEach, describe, expect, it } from "vitest";
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
  setWorkspaceState,
  toggleProjectCollapsed,
  updateWorkspace,
} from "./workspaceStore";

function workspace(overrides: Partial<Workspace> = {}): Workspace {
  return {
    id: "ws-1",
    branch: "feature-1",
    description: "Test workspace",
    path: "/home/user/.stagehand/worktrees/MyApp/feature-1",
    repo_root: "/home/user/Projects/MyApp",
    kind: "worktree",
    status: "ready",
    ...overrides,
  };
}

describe("workspaceStore", () => {
  beforeEach(() => {
    setWorkspaceState({
      projects: [],
      workspaces: [],
      selectedId: null,
      isLoading: false,
      error: null,
      setupProgressByWorkspaceId: {},
    });
  });

  describe("projects", () => {
    it("adds a project", () => {
      addProject("/home/user/Projects/MyApp");
      expect(getWorkspaceState().projects).toHaveLength(1);
      expect(getWorkspaceState().projects[0].repoRoot).toBe(
        "/home/user/Projects/MyApp",
      );
    });

    it("does not add duplicate projects", () => {
      addProject("/home/user/Projects/MyApp");
      addProject("/home/user/Projects/MyApp");
      expect(getWorkspaceState().projects).toHaveLength(1);
    });

    it("removes a project and its workspaces", () => {
      addProject("/home/user/Projects/MyApp");
      addWorkspace(workspace());
      removeProject("/home/user/Projects/MyApp");
      expect(getWorkspaceState().projects).toHaveLength(0);
      expect(getWorkspaceState().workspaces).toHaveLength(0);
    });

    it("clears selectedId when removing a project that owns the selected workspace", () => {
      addProject("/home/user/Projects/MyApp");
      addWorkspace(workspace());
      selectWorkspace("ws-1");
      removeProject("/home/user/Projects/MyApp");
      expect(getWorkspaceState().selectedId).toBeNull();
    });

    it("toggles project collapsed state", () => {
      addProject("/home/user/Projects/MyApp");
      expect(getWorkspaceState().projects[0].isCollapsed).toBe(false);
      toggleProjectCollapsed("/home/user/Projects/MyApp");
      expect(getWorkspaceState().projects[0].isCollapsed).toBe(true);
    });
  });

  describe("workspaces", () => {
    it("adds a workspace", () => {
      addWorkspace(workspace());
      expect(getWorkspaceState().workspaces).toHaveLength(1);
    });

    it("removes a workspace", () => {
      addWorkspace(workspace());
      removeWorkspace("ws-1");
      expect(getWorkspaceState().workspaces).toHaveLength(0);
    });

    it("clears selectedId when removing the selected workspace", () => {
      addWorkspace(workspace());
      selectWorkspace("ws-1");
      removeWorkspace("ws-1");
      expect(getWorkspaceState().selectedId).toBeNull();
    });

    it("updates workspace fields", () => {
      addWorkspace(workspace());
      updateWorkspace("ws-1", { status: "initializing" });
      expect(getWorkspaceState().workspaces[0].status).toBe("initializing");
    });

    it("sets and clears setup progress", () => {
      setSetupProgress("ws-1", {
        item: "node_modules",
        current: 1,
        total: 3,
      });
      expect(getWorkspaceState().setupProgressByWorkspaceId["ws-1"]).toEqual({
        item: "node_modules",
        current: 1,
        total: 3,
      });

      setSetupProgress("ws-1", null);
      expect(
        getWorkspaceState().setupProgressByWorkspaceId["ws-1"],
      ).toBeUndefined();
    });
  });

  describe("branch update propagation", () => {
    it("updateWorkspace updates branch on repo_root workspace", () => {
      const ws = workspace({
        kind: "repo_root",
        branch: "main",
        path: "/home/user/Projects/MyApp",
      });
      addWorkspace(ws);
      updateWorkspace("ws-1", { branch: "feature/new-branch" });

      const updated = getWorkspaceState().workspaces[0];
      expect(updated.branch).toBe("feature/new-branch");
    });

    it("setProjectBranch + updateWorkspace keep branch in sync", () => {
      const repoRoot = "/home/user/Projects/MyApp";
      addProject(repoRoot);
      const ws = workspace({
        kind: "repo_root",
        branch: "main",
        path: repoRoot,
      });
      addWorkspace(ws);

      const newBranch = "claude/str-3696-firetv-deeplink-focus";
      setProjectBranch(repoRoot, newBranch);
      updateWorkspace("ws-1", { branch: newBranch });

      const project = getWorkspaceState().projects.find(
        (p: Project) => p.repoRoot === repoRoot,
      );
      const wsResult = getWorkspaceState().workspaces[0];
      expect(project?.repoBranch).toBe(newBranch);
      expect(wsResult.branch).toBe(newBranch);
    });

    it("workspace.branch stays stale if only setProjectBranch is called (old behavior)", () => {
      const repoRoot = "/home/user/Projects/MyApp";
      addProject(repoRoot);
      const ws = workspace({
        kind: "repo_root",
        branch: "main",
        path: repoRoot,
      });
      addWorkspace(ws);

      setProjectBranch(repoRoot, "new-branch");

      const project = getWorkspaceState().projects.find(
        (p: Project) => p.repoRoot === repoRoot,
      );
      const wsState = getWorkspaceState().workspaces[0];
      expect(project?.repoBranch).toBe("new-branch");
      expect(wsState.branch).toBe("main");
    });
  });

  describe("mergeWorkspacesForProject", () => {
    it("preserves existing IDs when paths match", () => {
      const ws = workspace();
      addWorkspace(ws);

      const backendWs = { ...ws, id: "ws-new" };
      mergeWorkspacesForProject(ws.repo_root, [backendWs]);

      expect(getWorkspaceState().workspaces[0].id).toBe("ws-1");
    });

    it("adds new workspaces from backend", () => {
      mergeWorkspacesForProject("/home/user/Projects/MyApp", [workspace()]);
      expect(getWorkspaceState().workspaces).toHaveLength(1);
    });

    it("does not affect workspaces from other projects", () => {
      const otherWs = workspace({
        id: "ws-other",
        repo_root: "/other/project",
      });
      addWorkspace(otherWs);
      mergeWorkspacesForProject("/home/user/Projects/MyApp", [workspace()]);
      expect(getWorkspaceState().workspaces).toHaveLength(2);
    });
  });
});
