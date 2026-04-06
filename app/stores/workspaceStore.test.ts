import { describe, expect, it, beforeEach } from "vitest";
import { useWorkspaceStore } from "./workspaceStore";
import type { Workspace } from "../lib/types";

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
    useWorkspaceStore.setState({
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
      useWorkspaceStore.getState().addProject("/home/user/Projects/MyApp");
      expect(useWorkspaceStore.getState().projects).toHaveLength(1);
      expect(useWorkspaceStore.getState().projects[0].repoRoot).toBe(
        "/home/user/Projects/MyApp",
      );
    });

    it("does not add duplicate projects", () => {
      useWorkspaceStore.getState().addProject("/home/user/Projects/MyApp");
      useWorkspaceStore.getState().addProject("/home/user/Projects/MyApp");
      expect(useWorkspaceStore.getState().projects).toHaveLength(1);
    });

    it("removes a project and its workspaces", () => {
      useWorkspaceStore.getState().addProject("/home/user/Projects/MyApp");
      useWorkspaceStore.getState().addWorkspace(workspace());
      useWorkspaceStore.getState().removeProject("/home/user/Projects/MyApp");
      expect(useWorkspaceStore.getState().projects).toHaveLength(0);
      expect(useWorkspaceStore.getState().workspaces).toHaveLength(0);
    });

    it("clears selectedId when removing a project that owns the selected workspace", () => {
      useWorkspaceStore.getState().addProject("/home/user/Projects/MyApp");
      useWorkspaceStore.getState().addWorkspace(workspace());
      useWorkspaceStore.getState().selectWorkspace("ws-1");
      useWorkspaceStore.getState().removeProject("/home/user/Projects/MyApp");
      expect(useWorkspaceStore.getState().selectedId).toBeNull();
    });

    it("toggles project collapsed state", () => {
      useWorkspaceStore.getState().addProject("/home/user/Projects/MyApp");
      expect(useWorkspaceStore.getState().projects[0].isCollapsed).toBe(false);
      useWorkspaceStore
        .getState()
        .toggleProjectCollapsed("/home/user/Projects/MyApp");
      expect(useWorkspaceStore.getState().projects[0].isCollapsed).toBe(true);
    });
  });

  describe("workspaces", () => {
    it("adds a workspace", () => {
      useWorkspaceStore.getState().addWorkspace(workspace());
      expect(useWorkspaceStore.getState().workspaces).toHaveLength(1);
    });

    it("removes a workspace", () => {
      useWorkspaceStore.getState().addWorkspace(workspace());
      useWorkspaceStore.getState().removeWorkspace("ws-1");
      expect(useWorkspaceStore.getState().workspaces).toHaveLength(0);
    });

    it("clears selectedId when removing the selected workspace", () => {
      useWorkspaceStore.getState().addWorkspace(workspace());
      useWorkspaceStore.getState().selectWorkspace("ws-1");
      useWorkspaceStore.getState().removeWorkspace("ws-1");
      expect(useWorkspaceStore.getState().selectedId).toBeNull();
    });

    it("updates workspace fields", () => {
      useWorkspaceStore.getState().addWorkspace(workspace());
      useWorkspaceStore
        .getState()
        .updateWorkspace("ws-1", { status: "initializing" });
      expect(useWorkspaceStore.getState().workspaces[0].status).toBe(
        "initializing",
      );
    });

    it("sets and clears setup progress", () => {
      useWorkspaceStore.getState().setSetupProgress("ws-1", {
        item: "node_modules",
        current: 1,
        total: 3,
      });
      expect(
        useWorkspaceStore.getState().setupProgressByWorkspaceId["ws-1"],
      ).toEqual({ item: "node_modules", current: 1, total: 3 });

      useWorkspaceStore.getState().setSetupProgress("ws-1", null);
      expect(
        useWorkspaceStore.getState().setupProgressByWorkspaceId["ws-1"],
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
      useWorkspaceStore.getState().addWorkspace(ws);
      useWorkspaceStore
        .getState()
        .updateWorkspace("ws-1", { branch: "feature/new-branch" });

      const updated = useWorkspaceStore.getState().workspaces[0];
      expect(updated.branch).toBe("feature/new-branch");
    });

    it("setProjectBranch + updateWorkspace keep branch in sync", () => {
      const repoRoot = "/home/user/Projects/MyApp";
      useWorkspaceStore.getState().addProject(repoRoot);
      const ws = workspace({
        kind: "repo_root",
        branch: "main",
        path: repoRoot,
      });
      useWorkspaceStore.getState().addWorkspace(ws);

      // Simulate what the branch-changed event handler now does:
      const newBranch = "claude/str-3696-firetv-deeplink-focus";
      useWorkspaceStore.getState().setProjectBranch(repoRoot, newBranch);
      useWorkspaceStore
        .getState()
        .updateWorkspace("ws-1", { branch: newBranch });

      // Both sources should agree
      const project = useWorkspaceStore
        .getState()
        .projects.find((p) => p.repoRoot === repoRoot);
      const wsResult = useWorkspaceStore.getState().workspaces[0];
      expect(project?.repoBranch).toBe(newBranch);
      expect(wsResult.branch).toBe(newBranch);
    });

    it("workspace.branch stays stale if only setProjectBranch is called (old behavior)", () => {
      const repoRoot = "/home/user/Projects/MyApp";
      useWorkspaceStore.getState().addProject(repoRoot);
      const ws = workspace({
        kind: "repo_root",
        branch: "main",
        path: repoRoot,
      });
      useWorkspaceStore.getState().addWorkspace(ws);

      // Only call setProjectBranch (the old code path)
      useWorkspaceStore.getState().setProjectBranch(repoRoot, "new-branch");

      const project = useWorkspaceStore
        .getState()
        .projects.find((p) => p.repoRoot === repoRoot);
      const wsState = useWorkspaceStore.getState().workspaces[0];
      expect(project?.repoBranch).toBe("new-branch");
      expect(wsState.branch).toBe("main"); // still stale!
    });
  });

  describe("mergeWorkspacesForProject", () => {
    it("preserves existing IDs when paths match", () => {
      const ws = workspace();
      useWorkspaceStore.getState().addWorkspace(ws);

      // Backend returns the same workspace with a different ID
      const backendWs = { ...ws, id: "ws-new" };
      useWorkspaceStore
        .getState()
        .mergeWorkspacesForProject(ws.repo_root, [backendWs]);

      // Should keep the original ID
      expect(useWorkspaceStore.getState().workspaces[0].id).toBe("ws-1");
    });

    it("adds new workspaces from backend", () => {
      useWorkspaceStore
        .getState()
        .mergeWorkspacesForProject("/home/user/Projects/MyApp", [workspace()]);
      expect(useWorkspaceStore.getState().workspaces).toHaveLength(1);
    });

    it("does not affect workspaces from other projects", () => {
      const otherWs = workspace({
        id: "ws-other",
        repo_root: "/other/project",
      });
      useWorkspaceStore.getState().addWorkspace(otherWs);
      useWorkspaceStore
        .getState()
        .mergeWorkspacesForProject("/home/user/Projects/MyApp", [workspace()]);
      expect(useWorkspaceStore.getState().workspaces).toHaveLength(2);
    });
  });
});
