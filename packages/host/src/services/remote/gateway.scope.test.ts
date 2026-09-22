/**
 * Scope enforcement on the event side of the gateway. The request path is
 * `capabilities.scope.test.ts`; this covers the ways a guest could otherwise
 * *receive* what its scope excludes — subscriptions being the sharp one, since
 * a forwarded permission prompt is what makes `permission.respond` answerable.
 */

import type { PairedDevice } from "./deviceStore";
import type { Envelope, GrantScope } from "@argus/remote-protocol";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { generateKeypair, NoiseHandshake, type NoiseSession } from "./noise";

vi.mock("../../state", () => ({
  appState: {
    agents: new Map(),
    agentSnapshots: new Map(),
    agentPendingPermissions: new Map(),
    sessions: new Map(),
  },
}));
vi.mock("@argus/host/bus", () => ({
  addHostEventSink: vi.fn(() => () => undefined),
  emitHostEvent: vi.fn(),
}));
vi.mock("../agent/agentService", () => ({
  listAgents: vi.fn(() => []),
  respondToPermission: vi.fn(),
}));
vi.mock("../mcp/projectDiscovery", () => ({
  collectAllProjects: vi.fn(() => []),
}));
vi.mock("../session/manager", () => ({ listSessions: vi.fn(async () => []) }));
vi.mock("../session/sessionOps", () => ({
  getSessionBranchDiff: vi.fn(async () => ""),
  getSessionFullDiff: vi.fn(async () => ""),
}));
vi.mock("../simulator/ios", () => ({
  isSimulatorCapturing: vi.fn(() => false),
  listSimulators: vi.fn(async () => []),
  simulatorTouch: vi.fn(async () => undefined),
  simulatorButton: vi.fn(async () => undefined),
  simulatorKeyboard: vi.fn(async () => undefined),
  startSimulatorCapture: vi.fn(async () => undefined),
  stopSimulatorCapture: vi.fn(() => undefined),
  forceStopSimulatorCapture: vi.fn(() => undefined),
}));
vi.mock("../simulator/android", () => ({
  isAndroidCapturing: vi.fn(() => false),
  listAndroidDevices: vi.fn(async () => []),
  androidTouch: vi.fn(async () => undefined),
  androidButton: vi.fn(async () => undefined),
  androidKeyboard: vi.fn(async () => undefined),
  startAndroidCapture: vi.fn(async () => undefined),
  stopAndroidCapture: vi.fn(() => undefined),
  forceStopAndroidCapture: vi.fn(() => undefined),
}));
vi.mock("../simulator/videoForward", () => ({
  onVideo: vi.fn(() => () => undefined),
  getVideoDims: vi.fn(() => null),
}));

const { DeviceConnection } = await import("./gateway");
const { resetClaims } = await import("./deviceClaims");
const { respondToPermission } = vi.mocked(
  await import("../agent/agentService"),
);

const enc = new TextEncoder();
const dec = new TextDecoder();
const TAG_JSON = 0x00;

const frameJson = (env: unknown): Uint8Array => {
  const json = enc.encode(JSON.stringify(env));
  const out = new Uint8Array(1 + json.length);
  out[0] = TAG_JSON;
  out.set(json, 1);

  return out;
};

const baseDevice: PairedDevice = {
  device_id: "guest-1",
  label: "Ana",
  dev_static_pub: "",
  capabilities: ["monitor", "control"],
  created_at: 0,
  last_seen: null,
};

const SCOPE: GrantScope = { agent_ids: ["ag1"], device_keys: ["udid-1"] };

function connect(scope?: GrantScope, overrides: Partial<PairedDevice> = {}) {
  const client = generateKeypair();
  const host = generateKeypair();
  const ci = new NoiseHandshake({
    role: "initiator",
    staticKey: client,
    remoteStatic: host.pub,
  });
  const ri = new NoiseHandshake({ role: "responder", staticKey: host });
  ri.readMessage(ci.writeMessage(new Uint8Array(0)));
  ci.readMessage(ri.writeMessage(new Uint8Array(0)));
  const clientSession: NoiseSession = ci.session();

  const fromGateway: Envelope[] = [];
  const conn = new DeviceConnection(
    { ...baseDevice, ...overrides },
    ri.session(),
    (bytes) => {
      fromGateway.push(
        JSON.parse(
          dec.decode(clientSession.decrypt(bytes).subarray(1)),
        ) as Envelope,
      );
    },
    scope,
  );

  let seq = 0;
  const send = async (env: Record<string, unknown>) => {
    await conn.onFrame(
      clientSession.encrypt(frameJson({ seq: seq++, ...env })),
    );
  };

  return { conn, send, fromGateway };
}

const events = (sent: Envelope[], name: string) =>
  sent.filter((e) => (e as { event?: string }).event === name);

function seed(): void {
  vi.clearAllMocks();
  resetClaims();
}

describe("a scoped connection's subscriptions", () => {
  beforeEach(seed);

  it("forwards its own agent's events", async () => {
    const g = connect(SCOPE);
    await g.send({ type: "sub", action: "subscribe", agent_id: "ag1" });
    g.conn.handleBroadcast("agent:event:ag1", [{ kind: "text" }]);

    expect(events(g.fromGateway, "agent.event")).toHaveLength(1);
  });

  it("ignores a subscription to an agent outside the scope", async () => {
    const g = connect(SCOPE);
    await g.send({ type: "sub", action: "subscribe", agent_id: "ag2" });
    g.conn.handleBroadcast("agent:event:ag2", [{ kind: "text" }]);

    expect(events(g.fromGateway, "agent.event")).toHaveLength(0);
  });

  it("cannot answer a prompt for an agent outside the scope", async () => {
    const g = connect(SCOPE);
    await g.send({ type: "sub", action: "subscribe", agent_id: "ag2" });
    // Even if the host broadcasts it, nothing reaches the guest, so the reply
    // finds no outstanding prompt to settle.
    g.conn.handleBroadcast("agent:permission:ag2", [
      { tool_use_id: "t1", tool_name: "Bash", tool_input: {} },
    ]);

    expect(events(g.fromGateway, "permission.request")).toHaveLength(0);

    await g.send({
      type: "req",
      id: "r1",
      method: "permission.respond",
      params: { agent_id: "ag2", tool_use_id: "t1", decision: "allow" },
    });

    expect(respondToPermission).not.toHaveBeenCalled();
  });

  it("leaves an unscoped connection subscribing to anything", async () => {
    const d = connect();
    await d.send({ type: "sub", action: "subscribe", agent_id: "ag2" });
    d.conn.handleBroadcast("agent:event:ag2", [{ kind: "text" }]);

    expect(events(d.fromGateway, "agent.event")).toHaveLength(1);
  });
});

describe("a scoped connection's broadcast events", () => {
  beforeEach(seed);

  it("only sees notifications for its own agent", () => {
    const g = connect(SCOPE);
    for (const agent_id of ["ag1", "ag2", null]) {
      g.conn.handleBroadcast("remote:notification", [
        {
          agent_id,
          session_id: null,
          tool_use_id: null,
          kind: "finished",
          title: "t",
          body: "b",
        },
      ]);
    }

    expect(events(g.fromGateway, "notification")).toHaveLength(1);
  });

  it("only sees claim changes for its own device", () => {
    const g = connect(SCOPE);
    g.conn.handleBroadcast("devices:claim-changed", [
      { device_id: "udid-1", holder: null },
    ]);
    g.conn.handleBroadcast("devices:claim-changed", [
      { device_id: "udid-2", holder: null },
    ]);

    expect(events(g.fromGateway, "device.claim")).toEqual([
      expect.objectContaining({
        payload: expect.objectContaining({ device_id: "udid-1", holder: null }),
      }),
    ]);
  });

  it("never gets the raw IPC dialect, even with an admin grant", () => {
    const g = connect(SCOPE, { capabilities: ["admin"] });
    g.conn.handleBroadcast("projects:changed", [{}]);

    expect(events(g.fromGateway, "ipc")).toHaveLength(0);
  });
});
