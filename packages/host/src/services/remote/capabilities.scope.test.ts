/**
 * Scoped grants (huddle guests): a context carrying a `GrantScope` may only
 * address the agents and devices the scope names. Everything here is about the
 * second gate in `dispatch()` — the capability tier is tested elsewhere.
 *
 * The invariant that matters most: an *unscoped* context behaves exactly as it
 * did before scopes existed, so every already-paired device is unaffected.
 */

import type { GatewayContext } from "./capabilities";
import type { PairedDevice } from "./deviceStore";
import type { GrantScope, RemoteMethod } from "@argus/remote-protocol";
import {
  ALL_REMOTE_METHODS,
  METHOD_SCOPE,
  MethodParams,
} from "@argus/remote-protocol";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@argus/host/bus", () => ({ emitHostEvent: vi.fn() }));
vi.mock("../../state", () => ({
  appState: {
    agents: new Map(),
    agentSnapshots: new Map<string, string>(),
    agentPendingPermissions: new Map(),
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
  startAgent: vi.fn(async () => ({ agent_id: "a9" })),
}));
vi.mock("../file/operations", () => ({
  listSessionFiles: vi.fn(async () => ["a.ts"]),
  resolveMentionPath: vi.fn(async () => ({ entries: [], resolvedPath: "" })),
}));
vi.mock("../mcp/projects", () => ({
  collectAllProjects: vi.fn(() => [
    { path: "/repo/one" },
    { path: "/repo/two" },
  ]),
}));
vi.mock("../session/manager", () => ({
  listSessions: vi.fn(async () => [
    { id: "s1", repo_root: "/repo/one", kind: "worktree", branch: "b1" },
    { id: "s2", repo_root: "/repo/two", kind: "worktree", branch: "b2" },
  ]),
  createSession: vi.fn(),
  deleteSession: vi.fn(),
  renameSession: vi.fn(),
  renameSessionBranch: vi.fn(),
}));
vi.mock("../session/sessionOps", () => ({
  getSessionBranchDiff: vi.fn(async () => "diff"),
  getSessionFullDiff: vi.fn(async () => "diff"),
}));
vi.mock("../agent/chatHistory", () => ({
  loadConversation: vi.fn(() => null),
  loadHistoryIndex: vi.fn(() => [
    { id: "h1", sessionId: "r1", title: "old", messageCount: 2 },
  ]),
}));
vi.mock("../simulator/ios", () => ({
  isSimulatorCapturing: vi.fn(() => false),
  listSimulators: vi.fn(async () => [
    { udid: "udid-1", name: "iPhone", runtime: "iOS 18", booted: true },
    { udid: "udid-2", name: "iPad", runtime: "iOS 18", booted: true },
  ]),
  simulatorTouch: vi.fn(async () => undefined),
  simulatorButton: vi.fn(async () => undefined),
  simulatorKeyboard: vi.fn(async () => undefined),
}));
vi.mock("../simulator/android", () => ({
  isAndroidCapturing: vi.fn(() => false),
  listAndroidDevices: vi.fn(async () => []),
  androidTouch: vi.fn(async () => undefined),
  androidButton: vi.fn(async () => undefined),
  androidKeyboard: vi.fn(async () => undefined),
}));
vi.mock("../simulator/videoForward", () => ({
  onVideo: vi.fn(() => () => undefined),
  getVideoDims: vi.fn(() => null),
}));

const { appState } = await import("../../state");
const { dispatch, scopeSafeCapabilities } = await import("./capabilities");
const { resetClaims } = await import("./deviceClaims");

const SCOPE: GrantScope = {
  agent_ids: ["a1"],
  device_keys: ["udid-1", "browser:s1"],
};

const media = {
  watch: async () => 1,
  unwatch: () => undefined,
  watchBrowser: () => 2,
  unwatchBrowser: () => undefined,
};

function makeCtx(
  scope?: GrantScope,
  capabilities: PairedDevice["capabilities"] = ["monitor", "control"],
): GatewayContext {
  return {
    device: {
      device_id: "dev-1",
      label: "Guest",
      dev_static_pub: "",
      capabilities,
      created_at: 0,
      last_seen: null,
    },
    connectionId: "conn-1",
    outstandingPermissions: new Set(),
    media,
    ...(scope ? { scope } : {}),
  };
}

function agentFixture(agentId: string, sessionId: string) {
  return {
    agentId,
    sessionId,
    status: "running",
    model: "m",
    permissionMode: "auto",
    parentAgentId: null,
    createdAt: 0,
    lastEventAt: 0,
    toolUsesTotal: 0,
    turnsCompleted: 0,
    handle: { initializeResponse: () => null },
  } as never;
}

async function denied(
  method: string,
  params: unknown,
  ctx: GatewayContext,
): Promise<string> {
  try {
    await dispatch(method, params, ctx);
  } catch (err) {
    const e = err as { code?: string; message: string };

    expect(e.code).toBe("capability_denied");

    return e.message;
  }
  throw new Error(`${method} was allowed but should have been denied`);
}

beforeEach(() => {
  resetClaims();
  appState.agents.clear();
  appState.agents.set("a1", agentFixture("a1", "s1"));
  appState.agents.set("a2", agentFixture("a2", "s2"));
  appState.sessions.clear();
  appState.sessions.set("s1", {
    id: "s1",
    repo_root: "/repo/one",
    kind: "worktree",
    branch: "b1",
    status: "ready",
  } as never);
  appState.sessions.set("s2", {
    id: "s2",
    repo_root: "/repo/two",
    kind: "worktree",
    branch: "b2",
    status: "ready",
  } as never);
});

describe("an unscoped context is unaffected", () => {
  const ctx = makeCtx();

  it("reaches every agent", async () => {
    await expect(
      dispatch("agents.status", { agent_id: "a2" }, ctx),
    ).resolves.toMatchObject({ agent: { agent_id: "a2" } });
  });

  it("lists everything", async () => {
    const agents = (await dispatch("agents.list", {}, ctx)) as {
      agents: { agent_id: string }[];
    };

    expect(agents.agents.map((a) => a.agent_id).sort()).toEqual(["a1", "a2"]);

    const projects = (await dispatch("projects.list", {}, ctx)) as {
      projects: unknown[];
    };

    expect(projects.projects).toHaveLength(2);

    const devices = (await dispatch("devices.list", {}, ctx)) as {
      devices: unknown[];
    };

    expect(devices.devices).toHaveLength(2);
  });

  it("still reaches the methods a scope would refuse", async () => {
    await expect(
      dispatch("devices.claim", { device_id: "udid-2" }, ctx),
    ).resolves.toMatchObject({ granted: true });
  });
});

describe("a scoped context reaching its own subjects", () => {
  const ctx = makeCtx(SCOPE);

  it("allows its agent", async () => {
    await expect(
      dispatch("agents.status", { agent_id: "a1" }, ctx),
    ).resolves.toMatchObject({ agent: { agent_id: "a1" } });
    await expect(
      dispatch("agents.vitals", { agent_id: "a1" }, ctx),
    ).resolves.toMatchObject({ vitals: { agent_id: "a1" } });
  });

  it("allows its device and its browser", async () => {
    await expect(
      dispatch("devices.claim", { device_id: "udid-1" }, ctx),
    ).resolves.toMatchObject({ granted: true });
    await expect(
      dispatch("browser.watch", { session_id: "s1" }, ctx),
    ).resolves.toMatchObject({ stream_id: 2 });
  });

  it("allows the session its agent runs in", async () => {
    await expect(
      dispatch("sessions.diff", { session_id: "s1" }, ctx),
    ).resolves.toMatchObject({ diff: "diff" });
  });
});

describe("a scoped context reaching anything else", () => {
  const ctx = makeCtx(SCOPE);

  it("denies another agent", async () => {
    for (const method of [
      "agents.status",
      "agents.vitals",
      "agents.transcript",
      "agents.send",
      "agents.interrupt",
      "agents.stop",
      "agents.queue_list",
      "agents.set_model",
    ]) {
      expect(
        await denied(method, { agent_id: "a2", message: "hi" }, ctx),
      ).toContain("outside this grant's scope");
    }
  });

  it("denies another device and another browser", async () => {
    await denied("devices.watch", { device_id: "udid-2" }, ctx);
    await denied(
      "devices.touch",
      { device_id: "udid-2", platform: "ios", x: 0, y: 0, event_type: 0 },
      ctx,
    );
    await denied("browser.watch", { session_id: "s2" }, ctx);
  });

  it("denies another session", async () => {
    await denied("sessions.diff", { session_id: "s2" }, ctx);
    await denied("sessions.git_status", { session_id: "s2" }, ctx);
  });

  it("denies creating and destroying things outright", async () => {
    await denied("agents.spawn", { session_id: "s1" }, ctx);
    await denied("sessions.create", { repo_root: "/repo/one" }, ctx);
    await denied("sessions.delete", { id: "s1" }, ctx);
    await denied("sessions.checkout", { session_id: "s1", branch: "x" }, ctx);
    await denied(
      "agents.stopped_transcript",
      { repo_root: "/repo/one", history_id: "h1" },
      ctx,
    );
  });

  it("denies a missing or non-string subject rather than falling through", async () => {
    await denied("agents.status", {}, ctx);
    await denied("agents.status", { agent_id: 7 }, ctx);
    await denied("agents.status", null, ctx);
  });
});

describe("enumerating methods are filtered, not refused", () => {
  const ctx = makeCtx(SCOPE);

  it("narrows agents.list to the scoped agent", async () => {
    const res = (await dispatch("agents.list", {}, ctx)) as {
      agents: { agent_id: string }[];
    };

    expect(res.agents.map((a) => a.agent_id)).toEqual(["a1"]);
  });

  it("narrows projects.list to the scoped agent's repo", async () => {
    const res = (await dispatch("projects.list", {}, ctx)) as {
      projects: { repo_root: string }[];
    };

    expect(res.projects.map((p) => p.repo_root)).toEqual(["/repo/one"]);
  });

  it("narrows sessions.list to the scoped agent's session", async () => {
    const res = (await dispatch(
      "sessions.list",
      { repo_root: "/repo/one" },
      ctx,
    )) as { sessions: { id: string }[] };

    expect(res.sessions.map((s) => s.id)).toEqual(["s1"]);
  });

  it("narrows devices.list to the scoped device", async () => {
    const res = (await dispatch("devices.list", {}, ctx)) as {
      devices: { id: string }[];
    };

    expect(res.devices.map((d) => d.id)).toEqual(["udid-1"]);
  });

  it("returns no stopped agents, since none can be in scope", async () => {
    const res = (await dispatch(
      "agents.stopped",
      { repo_root: "/repo/one" },
      ctx,
    )) as { agents: unknown[] };

    expect(res.agents).toEqual([]);
  });
});

describe("a scoped grant can never be admin", () => {
  it("strips admin when minting one", () => {
    expect(scopeSafeCapabilities(["monitor", "control", "admin"])).toEqual([
      "monitor",
      "control",
    ]);
  });

  it("ignores an admin grant that somehow got scoped", async () => {
    const ctx = makeCtx(SCOPE, ["admin"]);
    // Admin no longer implies the narrower tiers…
    expect(await denied("agents.status", { agent_id: "a1" }, ctx)).toContain(
      "lacks 'monitor'",
    );
    // …and the raw IPC passthrough is unreachable.
    expect(await denied("list_projects", {}, ctx)).toContain("unknown method");
  });

  it("refuses the admin passthrough even for a scoped admin+control grant", async () => {
    const ctx = makeCtx(SCOPE, ["admin", "control", "monitor"]);

    expect(await denied("list_projects", {}, ctx)).toContain("unknown method");
  });
});

describe("the scope table covers every method", () => {
  it("has an entry for each remote method and no strays", () => {
    expect(Object.keys(METHOD_SCOPE).sort()).toEqual(
      [...ALL_REMOTE_METHODS].sort(),
    );
  });

  /**
   * The guard that makes a forgotten method a build failure rather than a hole:
   * anything carrying an `agent_id`/`device_id` param must be scope-checked
   * against that param, not quietly marked open or filtered.
   */
  it("scope-checks every agent- and device-addressed method", () => {
    for (const method of ALL_REMOTE_METHODS) {
      const shape = Object.keys(
        (MethodParams[method] as { shape: Record<string, unknown> }).shape,
      );
      const rule = METHOD_SCOPE[method as RemoteMethod];
      if (shape.includes("agent_id")) {
        expect([method, rule]).toEqual([
          method,
          { kind: "agent", param: "agent_id" },
        ]);
      }
      if (shape.includes("device_id")) {
        expect([method, rule]).toEqual([
          method,
          { kind: "device", param: "device_id" },
        ]);
      }
    }
  });

  it("names a param that the method's schema actually has", () => {
    for (const method of ALL_REMOTE_METHODS) {
      const rule = METHOD_SCOPE[method as RemoteMethod];
      if (!("param" in rule)) {
        continue;
      }
      const shape = Object.keys(
        (MethodParams[method] as { shape: Record<string, unknown> }).shape,
      );

      expect([method, shape.includes(rule.param)]).toEqual([method, true]);
    }
  });
});
