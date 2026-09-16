import type * as GitModule from "./git";
import type { Session } from "./models";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { appState } from "../../state";
import { createSession } from "./manager";

vi.mock("../../main", () => ({
  getMainWindow: () => null,
}));

vi.mock("./git", async () => {
  const actual = (await vi.importActual("./git")) as typeof GitModule;

  return {
    ...actual,
    git: vi.fn(async () => ""),
    repairOrphanedWorktrees: vi.fn(async () => {}),
  };
});

vi.mock("./setup", () => ({
  defaultArgusConfig: () => ({
    setup: { copy: [], symlink: [], commands: [] },
    terminals: [],
    workspace_env: [],
    run: null,
  }),
  loadArgusConfig: () => null,
  runSetupPipeline: vi.fn(async () => {}),
}));

function makeSession(partial: Partial<Session>): Session {
  return {
    id: partial.id ?? crypto.randomUUID(),
    kind: "worktree",
    branch: partial.branch ?? "feature",
    display_name:
      partial.display_name === undefined ? "Feature" : partial.display_name,
    description: partial.description ?? "",
    path: partial.path ?? "/tmp/feature",
    repo_root: partial.repo_root ?? "/repo",
    status: "ready",
    env_index: null,
    base_branch: null,
  };
}

// `createSession` now returns immediately with `status: "initializing"` and
// runs uniqueness validation in the background `finalizeSession` task, which
// reports collisions by flipping the session's status to `{ error: ... }`.
// These tests wait for the background task to settle and assert on that state.
async function waitForStatusError(id: string): Promise<string> {
  for (let i = 0; i < 50; i++) {
    const ws = appState.sessions.get(id);
    if (ws && typeof ws.status !== "string" && "error" in ws.status) {
      return ws.status.error;
    }
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error(`session ${id} never reached error status`);
}

describe("createSession — one-session-per-branch enforcement", () => {
  beforeEach(() => {
    appState.sessions.clear();
    // createSession only accepts registered projects.
    appState.repoRoots.add("/repo");
  });

  it("rejects creating a new-branch session whose branch is already claimed", async () => {
    appState.sessions.set(
      "ws-1",
      makeSession({
        id: "ws-1",
        branch: "feat-x",
        display_name: "Existing",
        repo_root: "/repo",
      }),
    );

    const pending = await createSession(
      "/repo",
      "feat-x",
      "desc",
      false,
      "main",
    );
    const error = await waitForStatusError(pending.id);
    expect(error).toMatch(/already used by session "Existing"/);
  });

  it("rejects adopting an existing branch already owned by another session", async () => {
    appState.sessions.set(
      "ws-2",
      makeSession({
        id: "ws-2",
        branch: "adopt-me",
        display_name: null,
        repo_root: "/repo",
      }),
    );

    const pending = await createSession(
      "/repo",
      "adopt-me",
      "desc",
      true,
      "main",
    );
    const error = await waitForStatusError(pending.id);
    expect(error).toMatch(/already used by session "adopt-me"/);
  });

  it("does not collide with a session for the same branch in a different repo", async () => {
    appState.sessions.set(
      "ws-3",
      makeSession({
        id: "ws-3",
        branch: "feat-x",
        repo_root: "/other-repo",
      }),
    );

    // Should not emit the collision error (finalization may fail later on the
    // mocked git, but not with the session-level uniqueness message).
    const pending = await createSession(
      "/repo",
      "feat-x",
      "desc",
      true,
      "main",
    );
    // Give the background task a tick to run past the uniqueness check.
    await new Promise((r) => setTimeout(r, 20));
    const ws = appState.sessions.get(pending.id);
    const errorMsg =
      ws && typeof ws.status !== "string" && "error" in ws.status
        ? ws.status.error
        : "";
    expect(errorMsg).not.toMatch(/already used by session/);
  });
});
