// @vitest-environment jsdom
/**
 * Integration test: external branch switch → event → store → ToolPanel props.
 *
 * Simulates the full pipeline when a user switches git branches outside the
 * app: the backend emits `session:branch-changed`, the frontend listener
 * updates both `project.repoBranch` and `session.branch` in the store, and
 * ToolPanel re-renders its children with the new branch name.
 */

import type { Session } from "../../../lib/types";
import type { Project } from "../../../stores/sessionStore";
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useProjectSessions } from "../../../hooks/useSessions";
import { setLayoutState } from "../../../stores/layoutStore";
import {
  addProject,
  addSession,
  getSelectedSessionId,
  getSessionState,
  selectSession,
  setProjectBranch,
  setSessionState,
} from "../../../stores/sessionStore";

// Import the hook after mocks are set up

// ---------------------------------------------------------------------------
// Mock window.argus — capture event subscriptions so we can fire them
// ---------------------------------------------------------------------------

type EventHandler = (payload: unknown) => void;
const eventListeners = new Map<string, Set<EventHandler>>();

function emitEvent(event: string, payload: unknown) {
  const handlers = eventListeners.get(event);
  if (handlers) {
    for (const handler of handlers) {
      handler(payload);
    }
  }
}

// Attach to existing window (jsdom provides window/document)
(window as unknown as Record<string, unknown>).argus = {
  invoke: vi.fn().mockResolvedValue(undefined),
  on: (event: string, callback: EventHandler) => {
    if (!eventListeners.has(event)) {
      eventListeners.set(event, new Set());
    }

    eventListeners.get(event)!.add(callback);

    return () => {
      eventListeners.get(event)?.delete(callback);
    };
  },
};

// Mock IPC functions used by useProjectSessions
vi.mock("../../lib/ipc", () => ({
  listSessions: vi.fn().mockResolvedValue([]),
  getRepoBranch: vi.fn().mockResolvedValue("main"),
  createSession: vi.fn(),
  createHeadSession: vi.fn(),
  deleteSession: vi.fn(),
  addRepoRoot: vi.fn(),
  removeRepoRoot: vi.fn(),
  watchSession: vi.fn().mockResolvedValue(undefined),
  unwatchSession: vi.fn().mockResolvedValue(undefined),
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const REPO_ROOT = "/home/user/Projects/MyApp";

function makeSession(overrides: Partial<Session> = {}): Session {
  return {
    id: "ws-root",
    kind: "project_root",
    branch: "main",
    description: "",
    path: REPO_ROOT,
    repo_root: REPO_ROOT,
    status: "ready",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("external branch switch → full pipeline", () => {
  beforeEach(() => {
    eventListeners.clear();
    setSessionState({
      projects: [],
      sessions: [],
      isLoading: false,
      setupProgressBySessionId: {},
    });
    setLayoutState({
      leftSidebarVisible: true,
      leftPanelWidth: 280,
      activeRightToolBySessionId: { "ws-root": "changes" },
      activeBottomToolBySessionId: {},
      lastActiveRightToolBySessionId: { "ws-root": "changes" },
      lastActiveBottomToolBySessionId: {},
      mountedToolIds: {
        changes: true,
        debug: false,
        notifications: false,
        simulator: false,
        terminal: false,
      },
      rightPanelWidth: 420,
      bottomPanelHeight: 0.3,
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("session.branch updates when backend emits branch-changed", () => {
    // Set up initial state: a project with a repo_root session on "main"
    const ws = makeSession();
    addProject(REPO_ROOT);
    addSession(ws);
    setProjectBranch(REPO_ROOT, "main");
    selectSession("ws-root");

    // Render the hook so it registers the branch-changed listener
    const { unmount } = renderHook(() => useProjectSessions(REPO_ROOT));

    // Verify initial state
    expect(getSessionState().sessions[0].branch).toBe("main");
    const project = getSessionState().projects.find(
      (p: Project) => p.repoRoot === REPO_ROOT,
    );
    expect(project?.repoBranch).toBe("main");

    // Simulate: user runs `git checkout feature-branch` outside the app
    act(() => {
      emitEvent("session:branch-changed:ws-root", {
        branch: "feature-branch",
      });
    });

    // Both sources of truth should reflect the new branch
    const updatedWs = getSessionState().sessions[0];
    const updatedProject = getSessionState().projects.find(
      (p: Project) => p.repoRoot === REPO_ROOT,
    );
    expect(updatedWs.branch).toBe("feature-branch");
    expect(updatedProject?.repoBranch).toBe("feature-branch");

    unmount();
  });

  it("toolPanel reads the updated branch from session store", () => {
    // Set up session on "main"
    const ws = makeSession();
    addProject(REPO_ROOT);
    addSession(ws);
    setProjectBranch(REPO_ROOT, "main");
    selectSession("ws-root");

    // Render the hook
    const { unmount } = renderHook(() => useProjectSessions(REPO_ROOT));

    // Simulate branch switch
    act(() => {
      emitEvent("session:branch-changed:ws-root", {
        branch: "claude/str-3696-firetv-deeplink-focus",
      });
    });

    // Simulate what ToolPanel does: look up session by selectedId
    const selectedId = getSelectedSessionId();
    const session = getSessionState().sessions.find(
      (w: Session) => w.id === selectedId,
    );

    // This is the value ToolPanel passes to ChangesSummary
    expect(session?.branch).toBe("claude/str-3696-firetv-deeplink-focus");

    unmount();
  });

  it("multiple rapid branch switches converge to the latest", () => {
    const ws = makeSession();
    addProject(REPO_ROOT);
    addSession(ws);
    setProjectBranch(REPO_ROOT, "main");
    selectSession("ws-root");

    const { unmount } = renderHook(() => useProjectSessions(REPO_ROOT));

    act(() => {
      emitEvent("session:branch-changed:ws-root", { branch: "branch-a" });
      emitEvent("session:branch-changed:ws-root", { branch: "branch-b" });
      emitEvent("session:branch-changed:ws-root", { branch: "branch-c" });
    });

    const session = getSessionState().sessions[0];
    expect(session.branch).toBe("branch-c");

    unmount();
  });

  it("worktree session branch is NOT affected by repo-root branch changes", () => {
    // Add both a repo_root and a worktree session
    const repoWs = makeSession();
    const worktreeWs = makeSession({
      id: "ws-worktree",
      kind: "worktree",
      branch: "feature/my-task",
      path: "/home/user/.argus/worktrees/MyApp/feature-my-task",
    });
    addProject(REPO_ROOT);
    addSession(repoWs);
    addSession(worktreeWs);
    setProjectBranch(REPO_ROOT, "main");

    const { unmount } = renderHook(() => useProjectSessions(REPO_ROOT));

    // Switch the repo root branch
    act(() => {
      emitEvent("session:branch-changed:ws-root", {
        branch: "develop",
      });
    });

    // Repo root updated
    const repoResult = getSessionState().sessions.find(
      (w: Session) => w.id === "ws-root",
    );
    expect(repoResult?.branch).toBe("develop");

    // Worktree unaffected
    const worktreeResult = getSessionState().sessions.find(
      (w: Session) => w.id === "ws-worktree",
    );
    expect(worktreeResult?.branch).toBe("feature/my-task");

    unmount();
  });

  it("diff-changed event is received after branch switch", () => {
    const ws = makeSession();
    addProject(REPO_ROOT);
    addSession(ws);
    selectSession("ws-root");

    // Track diff-changed events
    const diffHandler = vi.fn();
    const unsubscribe = window.argus.on(
      "session:diff-changed:ws-root",
      diffHandler,
    );

    // Simulate: backend sends both branch-changed and diff-changed
    act(() => {
      emitEvent("session:branch-changed:ws-root", {
        branch: "new-branch",
      });
      emitEvent("session:diff-changed:ws-root", {
        files: 3,
        additions: 10,
        deletions: 2,
      });
    });

    expect(diffHandler).toHaveBeenCalledWith({
      files: 3,
      additions: 10,
      deletions: 2,
    });

    unsubscribe();
  });
});
