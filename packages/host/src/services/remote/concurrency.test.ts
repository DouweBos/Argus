/**
 * Two attached clients on one host (plan §5.3): a settled permission prompt
 * must clear everywhere, the message queue must converge, and only one client
 * at a time may inject HID events into a device.
 */

import type { PairedDevice } from "./deviceStore";
import type { Envelope } from "@argus/remote-protocol";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { generateKeypair, NoiseHandshake, type NoiseSession } from "./noise";

vi.mock("../../state", () => ({
  appState: {
    agents: new Map(),
    agentPendingPermissions: new Map(),
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
vi.mock("../organization/manager", () => ({
  listOrganizations: vi.fn(() => []),
}));
vi.mock("../simulator/ios", () => ({
  isSimulatorCapturing: vi.fn(() => false),
  listAllSimulators: vi.fn(async () => []),
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

const { DeviceConnection, removeConnection } = await import("./gateway");
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
const unframeJson = (plain: Uint8Array): unknown =>
  JSON.parse(dec.decode(plain.subarray(1)));

const baseDevice: PairedDevice = {
  device_id: "dev-1",
  label: "Laptop",
  dev_static_pub: "",
  capabilities: ["monitor", "control"],
  created_at: 0,
  last_seen: null,
};

/** One authenticated client wired to a `DeviceConnection` over an in-memory pipe. */
function connect(overrides: Partial<PairedDevice> = {}) {
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
      fromGateway.push(unframeJson(clientSession.decrypt(bytes)) as Envelope);
    },
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

const lastError = (sent: Envelope[]) =>
  [...sent].reverse().find((e) => (e as { error?: unknown }).error) as
    | { error: { code: string; data?: unknown; message: string } }
    | undefined;

describe("two attached clients — permission prompts", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetClaims();
  });

  it("clears a prompt on the other client when one answers it", async () => {
    const a = connect();
    const b = connect({ device_id: "dev-2", label: "Mac mini" });
    // Stand in for the broadcast tap, which fans every renderer event out to
    // every live connection.
    const fanout = (channel: string, args: unknown[]) => {
      a.conn.handleBroadcast(channel, args);
      b.conn.handleBroadcast(channel, args);
    };
    respondToPermission.mockImplementation((agentId, toolUseId) => {
      fanout(`agent:permission-resolved:${agentId}`, [
        { tool_use_id: toolUseId, decision: "allow" },
      ]);
    });

    await a.send({ type: "sub", action: "subscribe", agent_id: "ag1" });
    await b.send({ type: "sub", action: "subscribe", agent_id: "ag1" });
    fanout("agent:permission:ag1", [
      { tool_use_id: "t1", tool_name: "Bash", tool_input: { command: "ls" } },
    ]);
    expect(events(a.fromGateway, "permission.request")).toHaveLength(1);
    expect(events(b.fromGateway, "permission.request")).toHaveLength(1);

    await a.send({
      type: "req",
      id: "r1",
      method: "permission.respond",
      params: { agent_id: "ag1", tool_use_id: "t1", decision: "allow" },
    });

    // B is told the prompt is settled...
    expect(events(b.fromGateway, "permission.cancel")).toEqual([
      expect.objectContaining({
        payload: { agent_id: "ag1", tool_use_id: "t1" },
      }),
    ]);
    // ...and a late answer from B is refused rather than double-written.
    await b.send({
      type: "req",
      id: "r2",
      method: "permission.respond",
      params: { agent_id: "ag1", tool_use_id: "t1", decision: "deny" },
    });
    expect(lastError(b.fromGateway)?.error.code).toBe("bad_request");
    expect(respondToPermission).toHaveBeenCalledTimes(1);
  });

  it("clears the raw dialect's outstanding prompt too", async () => {
    const admin = connect({ capabilities: ["admin"] });
    await admin.send({ type: "sub", action: "subscribe", agent_id: "ag1" });
    admin.conn.handleBroadcast("agent:permission:ag1", [
      { tool_use_id: "t1", tool_name: "Bash", tool_input: {} },
    ]);
    admin.conn.handleBroadcast("agent:permission-resolved:ag1", [
      { tool_use_id: "t1", decision: "allow" },
    ]);

    await admin.send({
      type: "req",
      id: "r1",
      method: "permission.respond",
      params: { agent_id: "ag1", tool_use_id: "t1", decision: "allow" },
    });
    expect(lastError(admin.fromGateway)?.error.code).toBe("bad_request");
    expect(respondToPermission).not.toHaveBeenCalled();
  });
});

describe("two attached clients — message queue", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetClaims();
  });

  it("gives both clients the whole queue after either edits it", async () => {
    const a = connect();
    const b = connect({ device_id: "dev-2", label: "Mac mini" });
    for (const c of [a, b]) {
      await c.send({ type: "sub", action: "subscribe", agent_id: "ag1" });
    }
    const messages = [{ id: "m1", text: "hi", queued_at: 1 }];
    for (const c of [a, b]) {
      c.conn.handleBroadcast("agent:queue:ag1", [messages]);
    }
    for (const c of [a, b]) {
      expect(events(c.fromGateway, "agent.queue")).toEqual([
        expect.objectContaining({ payload: { agent_id: "ag1", messages } }),
      ]);
    }
  });
});

describe("device claim", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetClaims();
  });

  const sendTouch = (c: ReturnType<typeof connect>, id: string) =>
    c.send({
      type: "req",
      id,
      method: "devices.touch",
      params: {
        device_id: "sim-1",
        platform: "ios",
        x: 0.5,
        y: 0.5,
        event_type: 0,
      },
    });

  it("refuses HID input from a second client while one holds the device", async () => {
    const a = connect();
    const b = connect({ device_id: "dev-2", label: "Mac mini" });
    await sendTouch(a, "t1");
    expect(lastError(a.fromGateway)).toBeUndefined();

    await sendTouch(b, "t2");
    const err = lastError(b.fromGateway);
    expect(err?.error.code).toBe("capability_denied");
    expect(err?.error.message).toContain("Laptop");
  });

  it("lets a second client take over explicitly", async () => {
    const a = connect();
    const b = connect({ device_id: "dev-2", label: "Mac mini" });
    await sendTouch(a, "t1");
    await b.send({
      type: "req",
      id: "c1",
      method: "devices.claim",
      params: { device_id: "sim-1", force: true },
    });
    await sendTouch(b, "t2");
    expect(lastError(b.fromGateway)).toBeUndefined();

    // The original holder is now view-only.
    await sendTouch(a, "t3");
    expect(lastError(a.fromGateway)?.error.code).toBe("capability_denied");
  });

  it("releases the claim when the holder disconnects", async () => {
    const a = connect();
    const b = connect({ device_id: "dev-2", label: "Mac mini" });
    await sendTouch(a, "t1");

    removeConnection(a.conn);

    await sendTouch(b, "t2");
    expect(lastError(b.fromGateway)).toBeUndefined();
    await b.send({
      type: "req",
      id: "s1",
      method: "devices.claim_status",
      params: { device_id: "sim-1" },
    });
    const res = b.fromGateway.at(-1) as {
      ok: { holder: { label: string } | null };
    };
    expect(res.ok.holder?.label).toBe("Mac mini");
  });

  it("tells a refused typed client who holds the device", async () => {
    const a = connect();
    const b = connect({ device_id: "dev-2", label: "Mac mini" });
    await sendTouch(a, "t1");
    await sendTouch(b, "t2");

    // Identical to what the raw admin path returns — one arbitration scheme,
    // so a desktop and a phone on the same host agree about who is driving.
    expect(lastError(b.fromGateway)?.error.data).toMatchObject({
      device_id: "sim-1",
      holder: { device_id: "dev-1", label: "Laptop" },
    });
  });

  it("keeps the claim out of reach of monitor-only devices", async () => {
    const m = connect({ capabilities: ["monitor"] });
    await m.send({
      type: "req",
      id: "c1",
      method: "devices.claim",
      params: { device_id: "sim-1" },
    });
    expect(lastError(m.fromGateway)?.error.code).toBe("capability_denied");
  });
});
