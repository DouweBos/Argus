/**
 * Capability gating for the control-scoped methods: a "monitor"-only device is
 * denied every write method, a "control" device is allowed, and project
 * creation is never reachable from the wire.
 */

import type { GatewayContext } from "./capabilities";
import type { PairedDevice } from "./deviceStore";
import type { AgentSession } from "../agent/models";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MethodResult, REMOTE_METHODS } from "@argus/remote-protocol";

vi.mock("../../broadcast", () => ({ broadcastToRenderers: vi.fn() }));
vi.mock("../../state", () => ({
  appState: {
    agents: new Map(),
    agentSnapshots: new Map<string, string>(),
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
vi.mock("../mcp/projects", () => ({ collectAllProjects: vi.fn(() => []) }));
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
vi.mock("../session/sessionOps", () => ({
  getSessionBranchDiff: vi.fn(async () => "diff --git a b"),
  getSessionFullDiff: vi.fn(async () => "diff --git HEAD"),
}));
vi.mock("../organization/manager", () => ({
  listOrganizations: vi.fn(() => []),
}));

const { appState } = await import("../../state");
const { dispatch } = await import("./capabilities");
const { sendAgentMessage, startAgent, stopAgent } = vi.mocked(
  await import("../agent/agentService"),
);
const { getSessionFullDiff, getSessionBranchDiff } = vi.mocked(
  await import("../session/sessionOps"),
);

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
    appState.sessions.clear();
    appState.sessions.set("s1", {
      id: "s1",
      base_branch: "main",
    } as never);
    appState.agents.clear();
    appState.agents.set("a1", {
      agentId: "a1",
      sessionId: "s1",
      status: "running",
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

  it("allows a control device to spawn an agent", async () => {
    const ctx = makeCtx(["monitor", "control"]);
    const res = (await dispatch("agents.spawn", { session_id: "s1" }, ctx)) as {
      agent: { agent_id: string };
    };
    expect(startAgent).toHaveBeenCalledWith(
      "s1",
      undefined,
      undefined,
      undefined,
    );
    expect(res.agent.agent_id).toBe("a1");
  });

  it("allows a control device to stop an agent", async () => {
    const ctx = makeCtx(["monitor", "control"]);
    await dispatch("agents.stop", { agent_id: "a1" }, ctx);
    expect(stopAgent).toHaveBeenCalledWith("a1");
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
