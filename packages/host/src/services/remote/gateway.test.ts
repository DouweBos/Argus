import type { PairedDevice } from "./deviceStore";
import type { Envelope } from "@argus/remote-protocol";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { generateKeypair, NoiseHandshake, type NoiseSession } from "./noise";

// The gateway calls into the service layer + appState; stub them so the test
// stays focused on dispatch/capability behaviour, not on spinning up agents.
vi.mock("../../state", () => ({
  appState: {
    agents: new Map(),
    agentPendingPermissions: new Map(),
    sessions: new Map([["s1", { id: "s1", repo_root: "/r" }]]),
  },
}));
vi.mock("../agent/agentService", () => ({
  listAgents: vi.fn(() => []),
  respondToPermission: vi.fn(),
}));
vi.mock("../mcp/projectDiscovery", () => ({
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

  it("streams a subscribed terminal to a phone as typed events", async () => {
    const { conn, send, fromGateway } = connect(["monitor"]);
    conn.handleBroadcast("terminal:data:t1", ["ZWFybHk="]);
    await send({ type: "sub", action: "subscribe", agent_id: "terminal:t1" });
    conn.handleBroadcast("terminal:data:t1", ["aGk="]);
    conn.handleBroadcast("terminal:data:t2", ["bm8="]);
    conn.handleBroadcast("terminal:exit:t1", [0]);
    expect(
      fromGateway.map((e) => {
        const { event, payload } = e as { event?: string; payload?: unknown };

        return { event, payload };
      }),
    ).toEqual([
      { event: "terminal.data", payload: { terminal_id: "t1", data: "aGk=" } },
      { event: "terminal.exit", payload: { terminal_id: "t1", exit_code: 0 } },
    ]);
  });

  it("scopes git runner progress to its run's subscription", async () => {
    const { conn, send, fromGateway } = connect(["admin"]);
    conn.handleBroadcast("git-runner:progress:r1", [{ chunk: "early" }]);
    await send({ type: "sub", action: "subscribe", agent_id: "git-runner:r1" });
    conn.handleBroadcast("git-runner:progress:r1", [{ chunk: "a" }]);
    conn.handleBroadcast("git-runner:progress:r2", [{ chunk: "b" }]);
    expect(
      ipcEvents(fromGateway).map(
        (e) => (e as unknown as { payload: { channel: string } }).payload,
      ),
    ).toEqual([{ channel: "git-runner:progress:r1", args: [{ chunk: "a" }] }]);
  });

  it("scopes the code editor's streams to their subscriptions", async () => {
    const { conn, send, fromGateway } = connect(["admin"]);
    await send({ type: "sub", action: "subscribe", agent_id: "code:s1" });
    await send({ type: "sub", action: "subscribe", agent_id: "lsp:s1" });
    await send({
      type: "sub",
      action: "subscribe",
      agent_id: "code-search:q1",
    });
    for (const channel of [
      "code:file-changed:s1",
      "code:file-changed:s2",
      "lsp:diagnostics:s1",
      "lsp:status:s1",
      "lsp:status:s2",
      "code:search:q1",
      "code:search:q2",
    ]) {
      conn.handleBroadcast(channel, [{}]);
    }
    expect(
      ipcEvents(fromGateway).map(
        (e) =>
          (e as unknown as { payload: { channel: string } }).payload.channel,
      ),
    ).toEqual([
      "code:file-changed:s1",
      "lsp:diagnostics:s1",
      "lsp:status:s1",
      "code:search:q1",
    ]);
  });

  it("streams a subscribed search to a phone as typed events", async () => {
    const { conn, send, fromGateway } = connect(["monitor", "control"]);
    const done = {
      kind: "done",
      searchId: "q1",
      count: 0,
      truncated: false,
      cancelled: false,
    };
    await send({
      type: "sub",
      action: "subscribe",
      agent_id: "code-search:q1",
    });
    conn.handleBroadcast("code:search:q1", [done]);
    conn.handleBroadcast("code:search:q2", [{ ...done, searchId: "q2" }]);
    expect(
      fromGateway.map((e) => {
        const { event, payload } = e as { event?: string; payload?: unknown };

        return { event, payload };
      }),
    ).toEqual([{ event: "files.search", payload: done }]);
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

describe("connection.typed_events", () => {
  beforeEach(() => vi.clearAllMocks());

  const eventNames = (sent: Envelope[]) =>
    sent
      .filter((e) => (e as { type?: string }).type === "evt")
      .map((e) => {
        const evt = e as unknown as {
          event: string;
          payload: { channel?: string };
        };

        return evt.event === "ipc" ? `ipc:${evt.payload.channel}` : evt.event;
      });

  const response = (sent: Envelope[], id: string) =>
    sent.find(
      (e) =>
        (e as { type?: string }).type === "res" &&
        (e as { id?: string }).id === id,
    ) as { ok?: unknown; error?: { code: string } } | undefined;

  it("is off by default: agent channels arrive raw only", async () => {
    const { conn, send, fromGateway } = connect(["admin"]);
    await send({ type: "sub", action: "subscribe", agent_id: "ag1" });
    conn.handleBroadcast("agent:event:ag1", [{ type: "x" }]);
    conn.handleBroadcast("session:created", [{ id: "s1", repo_root: "/r" }]);
    expect(eventNames(fromGateway)).toEqual([
      "ipc:agent:event:ag1",
      "ipc:session:created",
    ]);
  });

  it("when on, mirrors typed agent events and keeps raw non-agent channels", async () => {
    const { conn, send, fromGateway } = connect(["admin"]);
    await send({
      type: "req",
      id: "t",
      method: "connection.typed_events",
      params: { on: true },
    });
    expect(response(fromGateway, "t")?.ok).toEqual({});
    await send({ type: "sub", action: "subscribe", agent_id: "ag1" });
    fromGateway.length = 0;
    conn.handleBroadcast("agent:event:ag1", [{ type: "x" }]);
    conn.handleBroadcast("session:created", [{ id: "s1", repo_root: "/r" }]);
    conn.handleBroadcast("terminal:data:t1", ["aGk="]);
    expect(eventNames(fromGateway)).toEqual([
      "agent.event",
      "ipc:session:created",
      "sessions.changed",
    ]);
  });

  it("refreshes the session list when a session's setup finishes", async () => {
    const { conn, send, fromGateway } = connect(["admin"]);
    await send({
      type: "req",
      id: "t",
      method: "connection.typed_events",
      params: { on: true },
    });
    fromGateway.length = 0;
    conn.handleBroadcast("session:status:s1", ["ready"]);
    expect(eventNames(fromGateway)).toEqual([
      "ipc:session:status:s1",
      "sessions.changed",
    ]);
    expect(
      (fromGateway[1] as unknown as { payload: { repo_root: string } }).payload,
    ).toEqual({ repo_root: "/r" });
  });

  it("can be switched back off", async () => {
    const { conn, send, fromGateway } = connect(["admin"]);
    for (const [id, on] of [
      ["a", true],
      ["b", false],
    ] as const) {
      await send({
        type: "req",
        id,
        method: "connection.typed_events",
        params: { on },
      });
    }
    await send({ type: "sub", action: "subscribe", agent_id: "ag1" });
    fromGateway.length = 0;
    conn.handleBroadcast("agent:event:ag1", [{ type: "x" }]);
    expect(eventNames(fromGateway)).toEqual(["ipc:agent:event:ag1"]);
  });

  it("is refused for monitor and control devices", async () => {
    for (const caps of [["monitor"], ["monitor", "control"]] as const) {
      const { send, fromGateway } = connect([...caps]);
      await send({
        type: "req",
        id: "t",
        method: "connection.typed_events",
        params: { on: true },
      });
      expect(response(fromGateway, "t")?.error?.code).toBe("capability_denied");
    }
  });

  it("rejects malformed params", async () => {
    const { send, fromGateway } = connect(["admin"]);
    await send({
      type: "req",
      id: "t",
      method: "connection.typed_events",
      params: { on: "yes" },
    });
    expect(response(fromGateway, "t")?.error?.code).toBe("bad_request");
  });
});
