import type { Session } from "../session/models";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { addHostEventSink, resetHostEventSinks } from "../../bus";
import { appState } from "../../state";

const execFileMock = vi.hoisted(() => vi.fn());
vi.mock("node:child_process", () => ({ execFile: execFileMock }));
vi.mock("./pullRequests", () => ({
  getGithubSlugs: vi.fn(async (root: string) =>
    root === "/repo" ? ["me/app", "upstream/app"] : [],
  ),
}));
vi.mock("../session/argusConfig", () => ({
  isBranchProtected: (_root: string, branch: string) => branch === "main",
}));

const {
  buildPullRequestQuery,
  pickPullRequest,
  refreshRepoPullRequests,
  resetSessionPullRequests,
  sessionPullRequest,
} = await import("./sessionPullRequests");

function session(overrides: Partial<Session>): Session {
  return {
    id: "s1",
    kind: "worktree",
    branch: "feat/x",
    description: "",
    path: "/wt/s1",
    repo_root: "/repo",
    status: "ready",
    ...overrides,
  };
}

function node(
  overrides: Partial<Parameters<typeof pickPullRequest>[0][number]>,
) {
  return {
    number: 1,
    url: "https://github.com/me/app/pull/1",
    state: "OPEN" as const,
    isDraft: false,
    createdAt: "2026-01-01T00:00:00Z",
    headRepository: { nameWithOwner: "me/app" },
    ...overrides,
  };
}

function respond(data: unknown) {
  execFileMock.mockImplementationOnce(
    (
      _cmd: string,
      _args: string[],
      _opts: unknown,
      cb: (err: null, out: { stderr: string; stdout: string }) => void,
    ) => cb(null, { stdout: JSON.stringify({ data }), stderr: "" }),
  );
}

describe("pickPullRequest", () => {
  it("maps GitHub's states, draft included", () => {
    expect(pickPullRequest([node({ isDraft: true })], ["me/app"])?.state).toBe(
      "draft",
    );
    expect(
      pickPullRequest([node({ state: "MERGED" })], ["me/app"])?.state,
    ).toBe("merged");
    expect(
      pickPullRequest([node({ state: "CLOSED" })], ["me/app"])?.state,
    ).toBe("closed");
  });

  it("prefers the newest PR and ignores heads in someone else's fork", () => {
    const pr = pickPullRequest(
      [
        node({ number: 1, createdAt: "2026-01-01T00:00:00Z" }),
        node({
          number: 3,
          createdAt: "2026-03-01T00:00:00Z",
          headRepository: { nameWithOwner: "stranger/app" },
        }),
        node({ number: 2, createdAt: "2026-02-01T00:00:00Z" }),
      ],
      ["Me/App"],
    );
    expect(pr?.number).toBe(2);
  });
});

describe("buildPullRequestQuery", () => {
  it("passes every value as a variable, never inline", () => {
    const { query, variables } = buildPullRequestQuery([
      { owner: "me", name: "app", branch: 'a"b' },
    ]);
    expect(query).not.toContain('a"b');
    expect(variables).toEqual(["o0=me", "n0=app", 'h0=a"b']);
  });
});

describe("refreshRepoPullRequests", () => {
  const events: unknown[] = [];

  beforeEach(() => {
    resetSessionPullRequests();
    resetHostEventSinks();
    execFileMock.mockReset();
    appState.sessions.clear();
    events.length = 0;
    addHostEventSink((channel, args) => {
      if (channel === "session:updated") {
        events.push(args[0]);
      }
    });
  });

  afterEach(() => {
    appState.sessions.clear();
  });

  it("batches every session and slug into one gh call and emits changes", async () => {
    appState.sessions.set("s1", session({ id: "s1", branch: "feat/x" }));
    appState.sessions.set("s2", session({ id: "s2", branch: "feat/y" }));
    appState.sessions.set(
      "root",
      session({ id: "root", kind: "project_root", branch: "main" }),
    );
    respond({
      q0: { pullRequests: { nodes: [node({ number: 7, state: "MERGED" })] } },
      q1: { pullRequests: { nodes: [] } },
      q2: { pullRequests: { nodes: [] } },
      q3: null,
    });

    await refreshRepoPullRequests(["/repo"]);

    expect(execFileMock).toHaveBeenCalledTimes(1);
    expect(sessionPullRequest("s1")).toEqual({
      number: 7,
      state: "merged",
      url: "https://github.com/me/app/pull/1",
    });
    expect(sessionPullRequest("s2")).toBeNull();
    expect(events).toEqual([
      {
        id: "s1",
        repo_root: "/repo",
        pull_request: sessionPullRequest("s1"),
      },
    ]);

    // Unchanged on the next pass: nothing to tell clients.
    respond({
      q0: { pullRequests: { nodes: [node({ number: 7, state: "MERGED" })] } },
      q1: { pullRequests: { nodes: [] } },
      q2: { pullRequests: { nodes: [] } },
      q3: { pullRequests: { nodes: [] } },
    });
    await refreshRepoPullRequests(["/repo"]);
    expect(events).toHaveLength(1);
  });

  it("asks nothing for a repo without a GitHub remote", async () => {
    appState.sessions.set("s1", session({ repo_root: "/other" }));
    await refreshRepoPullRequests(["/other"]);
    expect(execFileMock).not.toHaveBeenCalled();
    expect(sessionPullRequest("s1")).toBeNull();
  });
});
