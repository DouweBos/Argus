import type { PairedDevice } from "./deviceStore";
import type { Envelope } from "@argus/remote-protocol";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { generateKeypair, NoiseHandshake, type NoiseSession } from "./noise";

// The gateway calls into the service layer + appState; stub them so the test
// stays focused on dispatch/capability behaviour, not on spinning up agents.
vi.mock("../../state", () => ({
  appState: { agents: new Map(), agentSnapshots: new Map() },
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
vi.mock("../organization/manager", () => ({
  listOrganizations: vi.fn(() => []),
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

/** Establish a real Noise IK pair and wire both ends together in memory. */
function connect() {
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
  const conn = new DeviceConnection(device, desktopSession, (bytes) => {
    fromGateway.push(
      JSON.parse(dec.decode(clientSession.decrypt(bytes))) as Envelope,
    );
  });

  let seq = 0;
  const send = async (env: Record<string, unknown>) => {
    const frame = clientSession.encrypt(
      enc.encode(JSON.stringify({ seq: seq++, ...env })),
    );
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
    const { send, fromGateway } = connect();
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
      out.push(JSON.parse(dec.decode(cs.decrypt(b))) as Envelope),
    );
    await conn.onFrame(
      cs.encrypt(
        enc.encode(
          JSON.stringify({
            seq: 0,
            type: "req",
            id: "1",
            method: "projects.list",
            params: {},
          }),
        ),
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
      out.push(JSON.parse(dec.decode(cs.decrypt(b))) as Envelope),
    );
    const frame = (seq: number) =>
      cs.encrypt(
        enc.encode(
          JSON.stringify({
            seq,
            type: "req",
            id: String(seq),
            method: "projects.list",
            params: {},
          }),
        ),
      );
    await conn.onFrame(frame(0));
    await conn.onFrame(frame(1));
    // Stale seq (0 again) must be ignored — no third response.
    await conn.onFrame(frame(0));
    expect(out).toHaveLength(2);
  });
});
