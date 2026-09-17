import type { PairedDevice } from "./deviceStore";
import type { Envelope } from "@argus/remote-protocol";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { generateKeypair, NoiseHandshake, type NoiseSession } from "./noise";

// The gateway calls into the service layer + appState; stub them so the test
// stays focused on dispatch/capability behaviour, not on spinning up agents.
vi.mock("../../state", () => ({
  appState: {
    agents: new Map(),
    agentSnapshots: new Map(),
    agentPendingPermissions: new Map(),
  },
}));
vi.mock("../agent/agentService", () => ({
  listAgents: vi.fn(() => []),
  respondToPermission: vi.fn(),
}));
vi.mock("../mcp/projects", () => ({
  collectAllProjects: vi.fn(() => [
    { path: "/repos/argus", description: "", registered: true, source: "" },
  ]),
}));
vi.mock("../session/manager", () => ({ listSessions: vi.fn(async () => []) }));
vi.mock("../session/sessionOps", () => ({
  getSessionBranchDiff: vi.fn(async () => ""),
  getSessionFullDiff: vi.fn(async () => ""),
}));

const { DeviceConnection } = await import("./gateway");

const device: PairedDevice = {
  device_id: "dev-1",
  label: "Phone",
  dev_static_pub: "",
  capabilities: ["monitor"],
  created_at: 0,
  last_seen: null,
};

const enc = new TextEncoder();
const dec = new TextDecoder();

// The gateway frames every JSON envelope with a leading TAG_JSON (0x00) byte.
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

/** Establish a real Noise IK pair and wire both ends together in memory. */
function connect(caps: PairedDevice["capabilities"] = device.capabilities) {
  const client = generateKeypair();
  const desktop = generateKeypair();
  const ci = new NoiseHandshake({
    role: "initiator",
    staticKey: client,
    remoteStatic: desktop.pub,
  });
  const ri = new NoiseHandshake({ role: "responder", staticKey: desktop });
  ri.readMessage(ci.writeMessage(new Uint8Array(0)));
  ci.readMessage(ri.writeMessage(new Uint8Array(0)));
  const clientSession: NoiseSession = ci.session();
  const desktopSession: NoiseSession = ri.session();

  const fromGateway: Envelope[] = [];
  const conn = new DeviceConnection(
    { ...device, capabilities: caps },
    desktopSession,
    (bytes) => {
      fromGateway.push(unframeJson(clientSession.decrypt(bytes)) as Envelope);
    },
  );

  let seq = 0;
  const send = async (env: Record<string, unknown>) => {
    const frame = clientSession.encrypt(frameJson({ seq: seq++, ...env }));
    await conn.onFrame(frame);
  };

  return { conn, send, fromGateway };
}

describe("gateway capability boundary", () => {
  beforeEach(() => vi.clearAllMocks());

  it("serves an allowed monitor method", async () => {
    const { send, fromGateway } = connect();
    await send({ type: "req", id: "1", method: "projects.list", params: {} });
    expect(fromGateway).toHaveLength(1);
    const res = fromGateway[0];
    expect(res.type).toBe("res");
    expect((res as { ok: { projects: unknown[] } }).ok.projects).toHaveLength(
      1,
    );
  });

  it.each([
    "agents.spawn",
    "send_agent_message",
    "write_session_file",
    "terminal.run",
    "spawn_agent",
    // The transfer channel writes to the host's disk: admin only, like the
    // `upload_session_attachment` / `write_file` commands it replaces.
    "transfer.upload.open",
    "transfer.download.open",
  ])(
    "rejects out-of-scope method %s with capability_denied",
    async (method) => {
      const { send, fromGateway } = connect();
      await send({ type: "req", id: "x", method, params: {} });
      const res = fromGateway[0] as { error?: { code: string } };
      expect(res.error?.code).toBe("capability_denied");
    },
  );

  it("refuses permission.respond for a prompt it never forwarded", async () => {
    const { send, fromGateway } = connect(["monitor", "control"]);
    await send({
      type: "req",
      id: "p",
      method: "permission.respond",
      params: { agent_id: "a", tool_use_id: "t", decision: "allow" },
    });
    const res = fromGateway[0] as { error?: { code: string } };
    expect(res.error?.code).toBe("bad_request");
  });

  it("denies methods when the device lacks the capability", async () => {
    const noCaps: PairedDevice = { ...device, capabilities: [] };
    const client = generateKeypair();
    const desktop = generateKeypair();
    const ci = new NoiseHandshake({
      role: "initiator",
      staticKey: client,
      remoteStatic: desktop.pub,
    });
    const ri = new NoiseHandshake({ role: "responder", staticKey: desktop });
    ri.readMessage(ci.writeMessage(new Uint8Array(0)));
    ci.readMessage(ri.writeMessage(new Uint8Array(0)));
    const cs = ci.session();
    const out: Envelope[] = [];
    const conn = new DeviceConnection(noCaps, ri.session(), (b) =>
      out.push(unframeJson(cs.decrypt(b)) as Envelope),
    );
    await conn.onFrame(
      cs.encrypt(
        frameJson({
          seq: 0,
          type: "req",
          id: "1",
          method: "projects.list",
          params: {},
        }),
      ),
    );
    expect((out[0] as { error?: { code: string } }).error?.code).toBe(
      "capability_denied",
    );
  });

  it("drops replayed/out-of-order frames", async () => {
    const client = generateKeypair();
    const desktop = generateKeypair();
    const ci = new NoiseHandshake({
      role: "initiator",
      staticKey: client,
      remoteStatic: desktop.pub,
    });
    const ri = new NoiseHandshake({ role: "responder", staticKey: desktop });
    ri.readMessage(ci.writeMessage(new Uint8Array(0)));
    ci.readMessage(ri.writeMessage(new Uint8Array(0)));
    const cs = ci.session();
    const out: Envelope[] = [];
    const conn = new DeviceConnection(device, ri.session(), (b) =>
      out.push(unframeJson(cs.decrypt(b)) as Envelope),
    );
    const frame = (seq: number) =>
      cs.encrypt(
        frameJson({
          seq,
          type: "req",
          id: String(seq),
          method: "projects.list",
          params: {},
        }),
      );
    await conn.onFrame(frame(0));
    await conn.onFrame(frame(1));
    // Stale seq (0 again) must be ignored — no third response.
    await conn.onFrame(frame(0));
    expect(out).toHaveLength(2);
  });
});

describe("raw broadcast forwarding", () => {
  beforeEach(() => vi.clearAllMocks());

  const ipcEvents = (sent: Envelope[]) =>
    sent.filter(
      (e) => (e as { type?: string; event?: string }).event === "ipc",
    );

  it("mirrors an unscoped renderer channel to an admin device", () => {
    const { conn, fromGateway } = connect(["admin"]);
    conn.handleBroadcast("projects:changed", [{ repo_root: "/r" }]);
    expect(ipcEvents(fromGateway)).toHaveLength(1);
    expect(
      (fromGateway[0] as unknown as { payload: { channel: string } }).payload,
    ).toEqual({ channel: "projects:changed", args: [{ repo_root: "/r" }] });
  });

  it("drops terminal output nobody subscribed to", () => {
    const { conn, fromGateway } = connect(["admin"]);
    conn.handleBroadcast("terminal:data:t1", ["aGk="]);
    expect(ipcEvents(fromGateway)).toHaveLength(0);
  });

  it("forwards only the subscribed terminal's output", async () => {
    const { conn, send, fromGateway } = connect(["admin"]);
    await send({ type: "sub", action: "subscribe", agent_id: "terminal:t1" });
    conn.handleBroadcast("terminal:data:t1", ["aGk="]);
    conn.handleBroadcast("terminal:data:t2", ["bm8="]);
    conn.handleBroadcast("terminal:exit:t1", [0]);
    expect(
      ipcEvents(fromGateway).map(
        (e) => (e as unknown as { payload: { channel: string } }).payload,
      ),
    ).toEqual([
      { channel: "terminal:data:t1", args: ["aGk="] },
      { channel: "terminal:exit:t1", args: [0] },
    ]);
  });

  it("tells typed clients when the device claim changes", () => {
    const { conn, fromGateway } = connect(["monitor", "control"]);
    conn.handleBroadcast("devices:claim-changed", [
      {
        device_id: "sim-1",
        holder: { connection_id: "c2", device_id: "dev-2", label: "Phone" },
      },
    ]);
    expect(fromGateway).toHaveLength(1);
    expect(fromGateway[0] as { event?: string }).toMatchObject({
      event: "device.claim",
      payload: { device_id: "sim-1", holder: { label: "Phone" } },
    });
  });

  it("keeps typed events for control devices", () => {
    const { conn, fromGateway } = connect(["control"]);
    conn.handleBroadcast("remote:notification", [
      {
        agent_id: null,
        session_id: null,
        tool_use_id: null,
        kind: "finished",
        title: "t",
        body: "b",
      },
    ]);
    expect(fromGateway).toHaveLength(1);
    expect((fromGateway[0] as { event?: string }).event).toBe("notification");
  });

  it("sends nothing raw to control devices", () => {
    const { conn, fromGateway } = connect(["control"]);
    conn.handleBroadcast("projects:changed", [{}]);
    expect(ipcEvents(fromGateway)).toHaveLength(0);
  });

  it("skips video, which TAG_MEDIA already carries", () => {
    const { conn, fromGateway } = connect(["admin"]);
    conn.handleBroadcast("ios_video_frame:abc", [{}]);
    conn.handleBroadcast("android_video_config:abc", [{}]);
    expect(ipcEvents(fromGateway)).toHaveLength(0);
  });

  it("still gates agent channels on subscription", () => {
    const { conn, fromGateway } = connect(["admin"]);
    conn.handleBroadcast("agent:event:unsubscribed", [{}]);
    expect(ipcEvents(fromGateway)).toHaveLength(0);
  });
});
