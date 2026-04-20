import type { Project } from "./sessionStore";
import type { Session } from "../lib/types";
import { beforeEach, describe, expect, it } from "vitest";
import {
  addProject,
  addSession,
  getSessionState,
  mergeSessionsForProject,
  removeProject,
  removeSession,
  selectSession,
  setProjectBranch,
  setSetupProgress,
  setSessionState,
  toggleProjectCollapsed,
  updateSession,
} from "./sessionStore";

function session(overrides: Partial<Session> = {}): Session {
  return {
    id: "ws-1",
    branch: "feature-1",
    description: "Test session",
    path: "/home/user/.argus/worktrees/MyApp/feature-1",
    repo_root: "/home/user/Projects/MyApp",
    kind: "worktree",
    status: "ready",
    ...overrides,
  };
}

describe("sessionStore", () => {
  beforeEach(() => {
    setSessionState({
      projects: [],
      sessions: [],
      selectedId: null,
      isLoading: false,
      setupProgressBySessionId: {},
    });
  });

  describe("projects", () => {
    it("adds a project", () => {
      addProject("/home/user/Projects/MyApp");
      expect(getSessionState().projects).toHaveLength(1);
      expect(getSessionState().projects[0].repoRoot).toBe(
        "/home/user/Projects/MyApp",
      );
    });

    it("does not add duplicate projects", () => {
      addProject("/home/user/Projects/MyApp");
      addProject("/home/user/Projects/MyApp");
      expect(getSessionState().projects).toHaveLength(1);
    });

    it("removes a project and its sessions", () => {
      addProject("/home/user/Projects/MyApp");
      addSession(session());
      removeProject("/home/user/Projects/MyApp");
      expect(getSessionState().projects).toHaveLength(0);
      expect(getSessionState().sessions).toHaveLength(0);
    });

    it("clears selectedId when removing a project that owns the selected session", () => {
      addProject("/home/user/Projects/MyApp");
      addSession(session());
      selectSession("ws-1");
      removeProject("/home/user/Projects/MyApp");
      expect(getSessionState().selectedId).toBeNull();
    });

    it("toggles project collapsed state", () => {
      addProject("/home/user/Projects/MyApp");
      expect(getSessionState().projects[0].isCollapsed).toBe(false);
      toggleProjectCollapsed("/home/user/Projects/MyApp");
      expect(getSessionState().projects[0].isCollapsed).toBe(true);
    });
  });

  describe("sessions", () => {
    it("adds a session", () => {
      addSession(session());
      expect(getSessionState().sessions).toHaveLength(1);
    });

    it("removes a session", () => {
      addSession(session());
      removeSession("ws-1");
      expect(getSessionState().sessions).toHaveLength(0);
    });

    it("clears selectedId when removing the selected session", () => {
      addSession(session());
      selectSession("ws-1");
      removeSession("ws-1");
      expect(getSessionState().selectedId).toBeNull();
    });

    it("updates session fields", () => {
      addSession(session());
      updateSession("ws-1", { status: "initializing" });
      expect(getSessionState().sessions[0].status).toBe("initializing");
    });

    it("sets and clears setup progress", () => {
      setSetupProgress("ws-1", {
        item: "node_modules",
        current: 1,
        total: 3,
      });
      expect(getSessionState().setupProgressBySessionId["ws-1"]).toEqual({
        item: "node_modules",
        current: 1,
        total: 3,
      });

      setSetupProgress("ws-1", null);
      expect(
        getSessionState().setupProgressBySessionId["ws-1"],
      ).toBeUndefined();
    });
  });

  describe("branch update propagation", () => {
    it("updateSession updates branch on repo_root session", () => {
      const ws = session({
        kind: "project_root",
        branch: "main",
        path: "/home/user/Projects/MyApp",
      });
      addSession(ws);
      updateSession("ws-1", { branch: "feature/new-branch" });

      const updated = getSessionState().sessions[0];
      expect(updated.branch).toBe("feature/new-branch");
    });

    it("setProjectBranch + updateSession keep branch in sync", () => {
      const repoRoot = "/home/user/Projects/MyApp";
      addProject(repoRoot);
      const ws = session({
        kind: "project_root",
        branch: "main",
        path: repoRoot,
      });
      addSession(ws);

      const newBranch = "claude/str-3696-firetv-deeplink-focus";
      setProjectBranch(repoRoot, newBranch);
      updateSession("ws-1", { branch: newBranch });

      const project = getSessionState().projects.find(
        (p: Project) => p.repoRoot === repoRoot,
      );
      const wsResult = getSessionState().sessions[0];
      expect(project?.repoBranch).toBe(newBranch);
      expect(wsResult.branch).toBe(newBranch);
    });

    it("session.branch stays stale if only setProjectBranch is called (old behavior)", () => {
      const repoRoot = "/home/user/Projects/MyApp";
      addProject(repoRoot);
      const ws = session({
        kind: "project_root",
        branch: "main",
        path: repoRoot,
      });
      addSession(ws);

      setProjectBranch(repoRoot, "new-branch");

      const project = getSessionState().projects.find(
        (p: Project) => p.repoRoot === repoRoot,
      );
      const wsState = getSessionState().sessions[0];
      expect(project?.repoBranch).toBe("new-branch");
      expect(wsState.branch).toBe("main");
    });
  });

  describe("mergeSessionsForProject", () => {
    it("preserves existing IDs when paths match", () => {
      const ws = session();
      addSession(ws);

      const backendWs = { ...ws, id: "ws-new" };
      mergeSessionsForProject(ws.repo_root, [backendWs]);

      expect(getSessionState().sessions[0].id).toBe("ws-1");
    });

    it("adds new sessions from backend", () => {
      mergeSessionsForProject("/home/user/Projects/MyApp", [session()]);
      expect(getSessionState().sessions).toHaveLength(1);
    });

    it("does not affect sessions from other projects", () => {
      const otherWs = session({
        id: "ws-other",
        repo_root: "/other/project",
      });
      addSession(otherWs);
      mergeSessionsForProject("/home/user/Projects/MyApp", [session()]);
      expect(getSessionState().sessions).toHaveLength(2);
    });
  });
});
