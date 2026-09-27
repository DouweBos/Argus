/**
 * Capability gating for the control-scoped methods: a "monitor"-only device is
 * denied every write method, a "control" device is allowed, and project
 * creation is never reachable from the wire.
 */

import type { GatewayContext } from "./capabilities";
import type { PairedDevice } from "./deviceStore";
import type { AgentSession } from "../agent/models";
import { MethodResult, REMOTE_METHODS } from "@argus/remote-protocol";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@argus/host/bus", () => ({ emitHostEvent: vi.fn() }));
vi.mock("../../state", () => ({
  appState: {
    agents: new Map(),
    agentSnapshots: new Map<string, string>(),
    agentPendingPermissions: new Map(),
    agentQueues: new Map(),
    sessions: new Map(),
  },
}));
vi.mock("../agent/agentService", () => ({
  respondToPermission: vi.fn(),
  sendAgentMessage: vi.fn(),
  interruptAgent: vi.fn(),
  stopAgent: vi.fn(),
  setAgentModel: vi.fn(),
  setAgentPermissionMode: vi.fn(),
  setAgentEffort: vi.fn(),
  startAgent: vi.fn(async () => ({ agent_id: "a1" })),
}));
vi.mock("../file/operations", () => ({
  listSessionFiles: vi.fn(async () => ["a.ts"]),
  resolveMentionPath: vi.fn(async () => ({ entries: [], resolvedPath: "" })),
}));
vi.mock("../mcp/projectDiscovery", () => ({
  collectAllProjects: vi.fn(() => [{ path: "/repo" }]),
}));
vi.mock("../agent/chatHistory", () => ({
  loadConversation: vi.fn(() => null),
  loadHistoryIndex: vi.fn(() =>
    Array.from({ length: 25 }, (_, i) => ({
      id: `h${i}`,
      sessionId: `r${i}`,
      title: `old ${i}`,
      sessionBranch: "feature/x",
      sessionDescription: "",
      messageCount: 2,
      createdAt: 0,
      endedAt: 0,
    })),
  ),
}));
vi.mock("../session/manager", () => ({
  listSessions: vi.fn(async () => []),
  createSession: vi.fn(),
  deleteSession: vi.fn(),
  renameSession: vi.fn(),
  renameSessionBranch: vi.fn(),
}));
vi.mock("../session/gitStatus", () => ({
  gitStatus: vi.fn(async () => ({
    branch: "feature/x",
    upstream: null,
    ahead: 2,
    behind: 0,
    dirtyCount: 3,
    stashCount: 0,
    conflictCount: 0,
    inProgress: null,
    detached: false,
    lastFetchAt: null,
  })),
}));
vi.mock("../session/gitBranchOps", () => ({
  gitCheckout: vi.fn(),
  gitCreateBranch: vi.fn(),
  gitDeleteBranch: vi.fn(),
  gitStashAndCheckout: vi.fn(),
  gitDiscardAndCheckout: vi.fn(),
  gitListLocalBranches: vi.fn(async () => [
    {
      name: "main",
      fullName: "refs/heads/main",
      upstream: "origin/main",
      ahead: 0,
      behind: 1,
      isCurrent: true,
      lastCommit: { hash: "abc", subject: "init", author: "a", timestamp: 5 },
    },
  ]),
  gitListRemoteBranches: vi.fn(async () => [
    {
      name: "origin/main",
      remote: "origin",
      branchName: "main",
      lastCommit: null,
    },
    {
      name: "origin/dev",
      remote: "origin",
      branchName: "dev",
      lastCommit: null,
    },
  ]),
}));
vi.mock("../session/sessionOps", () => ({
  getSessionBranchDiff: vi.fn(async () => "diff --git a b"),
  getSessionFullDiff: vi.fn(async () => "diff --git HEAD"),
}));
vi.mock("../llm/registry", () => ({
  getRunnerById: vi.fn((id: string) =>
    id === "codex" ? { id: "codex" } : null,
  ),
}));

const { appState } = await import("../../state");
const { dispatch } = await import("./capabilities");
const { sendAgentMessage, startAgent, stopAgent } = vi.mocked(
  await import("../agent/agentService"),
);
const { getSessionFullDiff, getSessionBranchDiff } = vi.mocked(
  await import("../session/sessionOps"),
);
const { gitCheckout, gitCreateBranch, gitDeleteBranch, gitStashAndCheckout } =
  vi.mocked(await import("../session/gitBranchOps"));
const { GitError } = await import("../session/gitError");

/** Every `startAgent` override past the session id, left unset. */
const SPAWN_DEFAULTS = Array<undefined>(9).fill(undefined);

function makeCtx(capabilities: PairedDevice["capabilities"]): GatewayContext {
  return {
    device: {
      device_id: "dev-1",
      label: "Phone",
      dev_static_pub: "",
      capabilities,
      created_at: 0,
      last_seen: null,
    },
    connectionId: "conn-1",
    outstandingPermissions: new Set(),
  };
}

const CONTROL_METHODS = [
  "agents.send",
  "agents.interrupt",
  "agents.stop",
  "agents.set_model",
  "agents.set_permission_mode",
  "agents.set_effort",
  "agents.spawn",
  "sessions.create",
  "sessions.delete",
  "sessions.rename",
  "sessions.rename_branch",
  "sessions.checkout",
  "sessions.create_branch",
  "sessions.delete_branch",
  "sessions.merge_branch",
  "sessions.rebase_current",
  "sessions.push_branch",
  "sessions.pull",
  "sessions.rename_local_branch",
  "sessions.pin_branch",
  "sessions.files",
  "sessions.resolve_mention_path",
  "agents.capabilities",
  "permission.respond",
] as const;

describe("control capability gating", () => {
  beforeEach(() => {
    sendAgentMessage.mockClear();
    startAgent.mockClear();
    stopAgent.mockClear();
    getSessionFullDiff.mockClear();
    getSessionBranchDiff.mockClear();
    gitCheckout.mockClear();
    gitCreateBranch.mockClear();
    gitDeleteBranch.mockClear();
    gitStashAndCheckout.mockClear();
    appState.sessions.clear();
    appState.sessions.set("s1", {
      id: "s1",
      base_branch: "main",
    } as never);
    appState.agentQueues.clear();
    appState.agentPendingPermissions.clear();
    appState.agents.clear();
    appState.agents.set("a1", {
      agentId: "a1",
      sessionId: "s1",
      status: "idle",
      inflightPrompts: 0,
      model: "m",
      permissionMode: "auto",
      parentAgentId: null,
      createdAt: 0,
      handle: {
        initializeResponse: () => ({
          models: [],
          commands: [],
          agents: [],
          output_style: "default",
          available_output_styles: [],
          account: {},
        }),
      },
    } as unknown as AgentSession);
  });

  it("denies every control method for a monitor-only device", async () => {
    const ctx = makeCtx(["monitor"]);
    for (const method of CONTROL_METHODS) {
      await expect(dispatch(method, { agent_id: "a1" }, ctx)).rejects.toThrow(
        /capability/,
      );
    }
    expect(sendAgentMessage).not.toHaveBeenCalled();
  });

  it("allows a control device to send a message", async () => {
    const ctx = makeCtx(["monitor", "control"]);
    await dispatch("agents.send", { agent_id: "a1", message: "hi" }, ctx);
    expect(sendAgentMessage).toHaveBeenCalledWith("a1", "hi", undefined);
  });

  it("queues a send that lands mid-turn instead of injecting it", async () => {
    const ctx = makeCtx(["monitor", "control"]);
    appState.agents.get("a1")!.status = "running";

    const res = await dispatch(
      "agents.send",
      { agent_id: "a1", message: "wait for me" },
      ctx,
    );

    expect(res).toMatchObject({ queued: true });
    expect(sendAgentMessage).not.toHaveBeenCalled();
    expect(appState.agentQueues.get("a1")).toHaveLength(1);
  });

  it("queues a send while a prompt is in flight, whatever the CLI reports", async () => {
    const ctx = makeCtx(["monitor", "control"]);
    // The CLI flips to idle between tool calls, so status alone says nothing.
    appState.agents.get("a1")!.inflightPrompts = 1;

    const res = await dispatch(
      "agents.send",
      { agent_id: "a1", message: "wait for me" },
      ctx,
    );

    expect(res).toMatchObject({ queued: true });
    expect(sendAgentMessage).not.toHaveBeenCalled();
  });

  it("still queues while the agent waits on a question", async () => {
    const ctx = makeCtx(["monitor", "control"]);
    appState.agents.get("a1")!.status = "running";
    appState.agents.get("a1")!.inflightPrompts = 1;
    appState.agentPendingPermissions.set(
      "a1",
      new Map([
        [
          "t1",
          { tool_use_id: "t1", tool_name: "AskUserQuestion", tool_input: {} },
        ],
      ]) as never,
    );

    await dispatch(
      "agents.send",
      { agent_id: "a1", message: "the red one" },
      ctx,
    );

    // The question has its own form; typing here is a message for the turn
    // after this one, not the answer.
    expect(sendAgentMessage).not.toHaveBeenCalled();
    expect(appState.agentQueues.get("a1")).toHaveLength(1);
  });

  it("keeps a send behind anything already queued", async () => {
    const ctx = makeCtx(["monitor", "control"]);
    appState.agentQueues.set("a1", [
      { id: "q1", text: "first", queued_at: 0 },
    ] as never);

    await dispatch("agents.send", { agent_id: "a1", message: "second" }, ctx);

    expect(sendAgentMessage).not.toHaveBeenCalled();
    expect(
      (appState.agentQueues.get("a1") as { text: string }[]).map((m) => m.text),
    ).toEqual(["first", "second"]);
  });

  it("allows a control device to spawn an agent", async () => {
    const ctx = makeCtx(["monitor", "control"]);
    const res = (await dispatch("agents.spawn", { session_id: "s1" }, ctx)) as {
      agent: { agent_id: string };
    };
    expect(startAgent).toHaveBeenCalledWith("s1", ...SPAWN_DEFAULTS);
    expect(res.agent.agent_id).toBe("a1");
  });

  it("spawns on the runner the client picked", async () => {
    const ctx = makeCtx(["monitor", "control"]);
    await dispatch(
      "agents.spawn",
      { session_id: "s1", runner_id: "codex" },
      ctx,
    );
    expect(startAgent).toHaveBeenCalledWith(
      "s1",
      ...SPAWN_DEFAULTS.slice(1),
      "codex",
    );
  });

  it("refuses a runner this computer no longer has", async () => {
    const ctx = makeCtx(["monitor", "control"]);
    await expect(
      dispatch("agents.spawn", { session_id: "s1", runner_id: "gone" }, ctx),
    ).rejects.toThrow(/unknown runner gone/);
    expect(startAgent).not.toHaveBeenCalled();
  });

  it("lists every stopped agent the history kept, like the desktop does", async () => {
    const ctx = makeCtx(["monitor", "control"]);
    const all = (await dispatch(
      "agents.stopped",
      { repo_root: "/repo" },
      ctx,
    )) as { agents: unknown[] };
    const capped = (await dispatch(
      "agents.stopped",
      { repo_root: "/repo", limit: 5 },
      ctx,
    )) as { agents: unknown[] };

    expect(all.agents).toHaveLength(25);
    expect(capped.agents).toHaveLength(5);
  });

  it("allows a control device to stop an agent", async () => {
    const ctx = makeCtx(["monitor", "control"]);
    await dispatch("agents.stop", { agent_id: "a1" }, ctx);
    expect(stopAgent).toHaveBeenCalledWith("a1");
  });

  it("switches branch for a control device", async () => {
    const ctx = makeCtx(["monitor", "control"]);
    const res = MethodResult["sessions.checkout"].parse(
      await dispatch(
        "sessions.checkout",
        { session_id: "s1", branch: "dev" },
        ctx,
      ),
    );
    expect(gitCheckout).toHaveBeenCalledWith("s1", { branch: "dev" });
    expect(res.accepted).toBe(true);
  });

  it("reports a dirty tree back instead of failing the checkout", async () => {
    gitCheckout.mockRejectedValueOnce(
      new GitError(
        "dirty-working-tree",
        "Working tree has uncommitted changes",
      ),
    );
    const res = MethodResult["sessions.checkout"].parse(
      await dispatch(
        "sessions.checkout",
        { session_id: "s1", branch: "dev" },
        makeCtx(["monitor", "control"]),
      ),
    );
    expect(res).toEqual({ accepted: false, blocked_by: "dirty" });
  });

  it("stashes when the client retries with a dirty strategy", async () => {
    await dispatch(
      "sessions.checkout",
      { session_id: "s1", branch: "dev", dirty: "stash" },
      makeCtx(["monitor", "control"]),
    );
    expect(gitStashAndCheckout).toHaveBeenCalledWith("s1", { branch: "dev" });
  });

  it("creates a branch and checks it out by default", async () => {
    await dispatch(
      "sessions.create_branch",
      { session_id: "s1", name: "feature/y", start_point: "main" },
      makeCtx(["monitor", "control"]),
    );
    expect(gitCreateBranch).toHaveBeenCalledWith("s1", {
      name: "feature/y",
      startPoint: "main",
      checkout: true,
    });
  });

  it("deletes a branch", async () => {
    const res = MethodResult["sessions.delete_branch"].parse(
      await dispatch(
        "sessions.delete_branch",
        { session_id: "s1", name: "old" },
        makeCtx(["monitor", "control"]),
      ),
    );
    expect(gitDeleteBranch).toHaveBeenCalledWith("s1", {
      name: "old",
      force: undefined,
    });
    expect(res.accepted).toBe(true);
  });

  it("asks before dropping unmerged commits instead of failing", async () => {
    gitDeleteBranch.mockRejectedValueOnce(
      new GitError("unknown", "error: the branch 'old' is not fully merged"),
    );
    const res = MethodResult["sessions.delete_branch"].parse(
      await dispatch(
        "sessions.delete_branch",
        { session_id: "s1", name: "old" },
        makeCtx(["monitor", "control"]),
      ),
    );
    expect(res).toEqual({ accepted: false, blocked_by: "unmerged" });
  });

  it("never exposes project creation on the wire", () => {
    expect("projects.create" in REMOTE_METHODS).toBe(false);
  });
});

describe("read-only changes review (monitor scope)", () => {
  beforeEach(() => {
    getSessionFullDiff.mockClear();
    getSessionBranchDiff.mockClear();
    appState.sessions.clear();
    appState.sessions.set("s1", { id: "s1", base_branch: "main" } as never);
  });

  it("lists local branches plus remote-only ones for monitor", async () => {
    const res = MethodResult["sessions.branches"].parse(
      await dispatch(
        "sessions.branches",
        { session_id: "s1" },
        makeCtx(["monitor"]),
      ),
    );
    expect(res.branches).toEqual([
      {
        name: "main",
        scope: "local",
        is_current: true,
        pinned: false,
        upstream: "origin/main",
        ahead: 0,
        behind: 1,
        last_commit_subject: "init",
        last_commit_at: 5,
      },
      {
        name: "dev",
        scope: "remote",
        remote: "origin",
        is_current: false,
        ahead: 0,
        behind: 0,
      },
    ]);
  });

  it("git_status is allowed for monitor and maps to snake_case", async () => {
    const res = MethodResult["sessions.git_status"].parse(
      await dispatch(
        "sessions.git_status",
        { session_id: "s1" },
        makeCtx(["monitor"]),
      ),
    );
    expect(res.status.branch).toBe("feature/x");
    expect(res.status.ahead).toBe(2);
    expect(res.status.dirty_count).toBe(3);
  });

  it("diff defaults to branch and switches to working", async () => {
    const ctx = makeCtx(["monitor"]);
    await dispatch("sessions.diff", { session_id: "s1" }, ctx);
    expect(getSessionBranchDiff).toHaveBeenCalledWith("s1", {});
    await dispatch("sessions.diff", { session_id: "s1", mode: "working" }, ctx);
    expect(getSessionFullDiff).toHaveBeenCalledWith("s1");
  });
});
