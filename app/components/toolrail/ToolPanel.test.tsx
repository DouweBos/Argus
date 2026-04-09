// @vitest-environment jsdom
/**
 * Integration test: external branch switch → event → store → ToolPanel props.
 *
 * Simulates the full pipeline when a user switches git branches outside the
 * app: the backend emits `workspace:branch-changed`, the frontend listener
 * updates both `project.repoBranch` and `workspace.branch` in the store, and
 * ToolPanel re-renders its children with the new branch name.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useWorkspaceStore } from "../../stores/workspaceStore";
import { useLayoutStore } from "../../stores/layoutStore";
import type { Workspace } from "../../lib/types";

// ---------------------------------------------------------------------------
// Mock window.stagehand — capture event subscriptions so we can fire them
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
(window as unknown as Record<string, unknown>).stagehand = {
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

// Mock IPC functions used by useProjectWorkspaces
vi.mock("../../lib/ipc", () => ({
  listWorkspaces: vi.fn().mockResolvedValue([]),
  getRepoBranch: vi.fn().mockResolvedValue("main"),
  createWorkspace: vi.fn(),
  createHeadWorkspace: vi.fn(),
  deleteWorkspace: vi.fn(),
  addRepoRoot: vi.fn(),
  removeRepoRoot: vi.fn(),
  watchWorkspace: vi.fn().mockResolvedValue(undefined),
  unwatchWorkspace: vi.fn().mockResolvedValue(undefined),
}));

// Import the hook after mocks are set up
import { useProjectWorkspaces } from "../../hooks/useWorkspaces";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const REPO_ROOT = "/home/user/Projects/MyApp";

function makeWorkspace(overrides: Partial<Workspace> = {}): Workspace {
  return {
    id: "ws-root",
    kind: "repo_root",
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
    useWorkspaceStore.setState({
      projects: [],
      workspaces: [],
      selectedId: null,
      isLoading: false,
      error: null,
      setupProgressByWorkspaceId: {},
    });
    useLayoutStore.setState({
      activeToolId: "changes",
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("workspace.branch updates when backend emits branch-changed", () => {
    // Set up initial state: a project with a repo_root workspace on "main"
    const ws = makeWorkspace();
    useWorkspaceStore.getState().addProject(REPO_ROOT);
    useWorkspaceStore.getState().addWorkspace(ws);
    useWorkspaceStore.getState().setProjectBranch(REPO_ROOT, "main");
    useWorkspaceStore.getState().selectWorkspace("ws-root");

    // Render the hook so it registers the branch-changed listener
    const { unmount } = renderHook(() => useProjectWorkspaces(REPO_ROOT));

    // Verify initial state
    expect(useWorkspaceStore.getState().workspaces[0].branch).toBe("main");
    const project = useWorkspaceStore
      .getState()
      .projects.find((p) => p.repoRoot === REPO_ROOT);
    expect(project?.repoBranch).toBe("main");

    // Simulate: user runs `git checkout feature-branch` outside the app
    act(() => {
      emitEvent("workspace:branch-changed:ws-root", {
        branch: "feature-branch",
      });
    });

    // Both sources of truth should reflect the new branch
    const updatedWs = useWorkspaceStore.getState().workspaces[0];
    const updatedProject = useWorkspaceStore
      .getState()
      .projects.find((p) => p.repoRoot === REPO_ROOT);
    expect(updatedWs.branch).toBe("feature-branch");
    expect(updatedProject?.repoBranch).toBe("feature-branch");

    unmount();
  });

  it("ToolPanel reads the updated branch from workspace store", () => {
    // Set up workspace on "main"
    const ws = makeWorkspace();
    useWorkspaceStore.getState().addProject(REPO_ROOT);
    useWorkspaceStore.getState().addWorkspace(ws);
    useWorkspaceStore.getState().setProjectBranch(REPO_ROOT, "main");
    useWorkspaceStore.getState().selectWorkspace("ws-root");

    // Render the hook
    const { unmount } = renderHook(() => useProjectWorkspaces(REPO_ROOT));

    // Simulate branch switch
    act(() => {
      emitEvent("workspace:branch-changed:ws-root", {
        branch: "claude/str-3696-firetv-deeplink-focus",
      });
    });

    // Simulate what ToolPanel does: look up workspace by selectedId
    const selectedId = useWorkspaceStore.getState().selectedId;
    const workspace = useWorkspaceStore
      .getState()
      .workspaces.find((w) => w.id === selectedId);

    // This is the value ToolPanel passes to ChangesSummary
    expect(workspace?.branch).toBe("claude/str-3696-firetv-deeplink-focus");

    unmount();
  });

  it("multiple rapid branch switches converge to the latest", () => {
    const ws = makeWorkspace();
    useWorkspaceStore.getState().addProject(REPO_ROOT);
    useWorkspaceStore.getState().addWorkspace(ws);
    useWorkspaceStore.getState().setProjectBranch(REPO_ROOT, "main");
    useWorkspaceStore.getState().selectWorkspace("ws-root");

    const { unmount } = renderHook(() => useProjectWorkspaces(REPO_ROOT));

    act(() => {
      emitEvent("workspace:branch-changed:ws-root", { branch: "branch-a" });
      emitEvent("workspace:branch-changed:ws-root", { branch: "branch-b" });
      emitEvent("workspace:branch-changed:ws-root", { branch: "branch-c" });
    });

    const workspace = useWorkspaceStore.getState().workspaces[0];
    expect(workspace.branch).toBe("branch-c");

    unmount();
  });

  it("worktree workspace branch is NOT affected by repo-root branch changes", () => {
    // Add both a repo_root and a worktree workspace
    const repoWs = makeWorkspace();
    const worktreeWs = makeWorkspace({
      id: "ws-worktree",
      kind: "worktree",
      branch: "feature/my-task",
      path: "/home/user/.stagehand/worktrees/MyApp/feature-my-task",
    });
    useWorkspaceStore.getState().addProject(REPO_ROOT);
    useWorkspaceStore.getState().addWorkspace(repoWs);
    useWorkspaceStore.getState().addWorkspace(worktreeWs);
    useWorkspaceStore.getState().setProjectBranch(REPO_ROOT, "main");

    const { unmount } = renderHook(() => useProjectWorkspaces(REPO_ROOT));

    // Switch the repo root branch
    act(() => {
      emitEvent("workspace:branch-changed:ws-root", {
        branch: "develop",
      });
    });

    // Repo root updated
    const repoResult = useWorkspaceStore
      .getState()
      .workspaces.find((w) => w.id === "ws-root");
    expect(repoResult?.branch).toBe("develop");

    // Worktree unaffected
    const worktreeResult = useWorkspaceStore
      .getState()
      .workspaces.find((w) => w.id === "ws-worktree");
    expect(worktreeResult?.branch).toBe("feature/my-task");

    unmount();
  });

  it("diff-changed event is received after branch switch", () => {
    const ws = makeWorkspace();
    useWorkspaceStore.getState().addProject(REPO_ROOT);
    useWorkspaceStore.getState().addWorkspace(ws);
    useWorkspaceStore.getState().selectWorkspace("ws-root");

    // Track diff-changed events
    const diffHandler = vi.fn();
    const unsubscribe = window.stagehand.on(
      "workspace:diff-changed:ws-root",
      diffHandler,
    );

    // Simulate: backend sends both branch-changed and diff-changed
    act(() => {
      emitEvent("workspace:branch-changed:ws-root", {
        branch: "new-branch",
      });
      emitEvent("workspace:diff-changed:ws-root", {
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
