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
vi.mock("../mcp/projectDiscovery", () => ({
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
  listAllSimulators: vi.fn(async () => [
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
    costUsd: 0,
    turnsCompleted: 0,
    handle: { initializeResponse: () => null },
  } as never;
}

/** Dispatch expecting a refusal; resolves to "<code>: <message>". */
async function denied(
  method: string,
  params: unknown,
  ctx: GatewayContext,
): Promise<string> {
  try {
    await dispatch(method, params, ctx);
  } catch (err) {
    const e = err as { code?: string; message: string };

    return `${e.code ?? "?"}: ${e.message}`;
  }
  throw new Error(`${method} was allowed but should have been denied`);
}

const OUT_OF_SCOPE = /^capability_denied: .+ is outside this grant's scope$/;

/** Two agents, in two sessions, in two projects. */
function seed(): void {
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
}

describe("an unscoped context is unaffected", () => {
  const ctx = makeCtx();

  beforeEach(seed);

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

  beforeEach(seed);

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

  beforeEach(seed);

  it("denies another agent", async () => {
    const methods = [
      "agents.status",
      "agents.vitals",
      "agents.transcript",
      "agents.image",
      "agents.capabilities",
      "agents.send",
      "agents.interrupt",
      "agents.stop",
      "agents.set_model",
      "agents.set_permission_mode",
      "agents.set_effort",
      "agents.queue_list",
      "agents.queue_add",
      "agents.queue_remove",
      "agents.queue_update",
      "agents.queue_send_now",
      "permission.respond",
    ];
    const results = await Promise.all(
      methods.map((m) =>
        denied(m, { agent_id: "a2", message: "hi", id: "q1" }, ctx),
      ),
    );

    expect(results).toEqual(
      methods.map(() => expect.stringMatching(OUT_OF_SCOPE)),
    );
  });

  it("denies another device and another browser", async () => {
    const results = await Promise.all([
      denied("devices.watch", { device_id: "udid-2" }, ctx),
      denied("devices.claim", { device_id: "udid-2" }, ctx),
      denied(
        "devices.touch",
        { device_id: "udid-2", platform: "ios", x: 0, y: 0, event_type: 0 },
        ctx,
      ),
      denied("browser.watch", { session_id: "s2" }, ctx),
    ]);

    expect(results).toEqual(
      results.map(() => expect.stringMatching(OUT_OF_SCOPE)),
    );
    expect(results).toHaveLength(4);
  });

  it("denies another session", async () => {
    const results = await Promise.all([
      denied("sessions.diff", { session_id: "s2" }, ctx),
      denied("sessions.git_status", { session_id: "s2" }, ctx),
      denied("sessions.files", { session_id: "s2" }, ctx),
      denied("files.read", { session_id: "s2", path: "a.ts" }, ctx),
      denied(
        "files.search",
        { session_id: "s2", search_id: "q", query: "x" },
        ctx,
      ),
      denied("files.search_cancel", { session_id: "s2", search_id: "q" }, ctx),
    ]);

    expect(results).toEqual(
      results.map(() => expect.stringMatching(OUT_OF_SCOPE)),
    );
    expect(results).toHaveLength(6);
  });

  it("denies creating and destroying things outright", async () => {
    const results = await Promise.all([
      denied("agents.spawn", { session_id: "s1" }, ctx),
      denied("sessions.create", { repo_root: "/repo/one" }, ctx),
      denied("sessions.delete", { id: "s1" }, ctx),
      denied("sessions.checkout", { session_id: "s1", branch: "x" }, ctx),
      denied(
        "agents.stopped_transcript",
        { repo_root: "/repo/one", history_id: "h1" },
        ctx,
      ),
    ]);

    expect(results).toEqual([
      expect.stringMatching(OUT_OF_SCOPE),
      expect.stringMatching(OUT_OF_SCOPE),
      expect.stringMatching(OUT_OF_SCOPE),
      expect.stringMatching(OUT_OF_SCOPE),
      expect.stringMatching(OUT_OF_SCOPE),
    ]);
  });

  it("denies a missing or non-string subject rather than falling through", async () => {
    const results = await Promise.all([
      denied("agents.status", {}, ctx),
      denied("agents.status", { agent_id: 7 }, ctx),
      denied("agents.status", null, ctx),
    ]);

    expect(results).toEqual([
      expect.stringMatching(OUT_OF_SCOPE),
      expect.stringMatching(OUT_OF_SCOPE),
      expect.stringMatching(OUT_OF_SCOPE),
    ]);
  });
});

describe("enumerating methods are filtered, not refused", () => {
  const ctx = makeCtx(SCOPE);

  beforeEach(seed);

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
  beforeEach(seed);

  it("strips admin when minting one", () => {
    expect(scopeSafeCapabilities(["monitor", "control", "admin"])).toEqual([
      "monitor",
      "control",
    ]);
  });

  it("ignores an admin grant that somehow got scoped", async () => {
    const ctx = makeCtx(SCOPE, ["admin"]);
    // Admin no longer implies the narrower tiers…
    await expect(
      denied("agents.status", { agent_id: "a1" }, ctx),
    ).resolves.toContain("lacks 'monitor'");
    // …and the raw IPC passthrough is unreachable.
    await expect(denied("list_projects", {}, ctx)).resolves.toContain(
      "unknown method",
    );
  });

  it("refuses the admin passthrough even for a scoped admin+control grant", async () => {
    const ctx = makeCtx(SCOPE, ["admin", "control", "monitor"]);

    await expect(denied("list_projects", {}, ctx)).resolves.toContain(
      "unknown method",
    );
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
  const shapeOf = (method: RemoteMethod): string[] =>
    Object.keys(
      (MethodParams[method] as { shape: Record<string, unknown> }).shape,
    );

  /**
   * The guard that makes a forgotten method a hole the build catches: anything
   * carrying an `agent_id`/`device_id` param must be scope-checked against that
   * param, not quietly marked open, filtered or denied.
   */
  it("scope-checks every agent- and device-addressed method", () => {
    const byParam = (param: string, kind: string) =>
      ALL_REMOTE_METHODS.filter((m) => shapeOf(m).includes(param)).map((m) => [
        m,
        METHOD_SCOPE[m].kind === kind &&
          (METHOD_SCOPE[m] as { param?: string }).param === param,
      ]);

    expect(byParam("agent_id", "agent").map(([, ok]) => ok)).not.toContain(
      false,
    );
    expect(byParam("device_id", "device").map(([, ok]) => ok)).not.toContain(
      false,
    );
    // …and the tables aren't vacuously empty.
    expect(byParam("agent_id", "agent").length).toBeGreaterThan(15);
    expect(byParam("device_id", "device").length).toBeGreaterThan(5);
  });

  it("names a param that the method's schema actually has", () => {
    const strays = ALL_REMOTE_METHODS.filter((m) => {
      const rule = METHOD_SCOPE[m];

      return "param" in rule && !shapeOf(m).includes(rule.param);
    });

    expect(strays).toEqual([]);
  });
});
