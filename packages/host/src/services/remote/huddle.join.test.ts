/**
 * The join flow end to end, over a real socket: an unknown key handshakes,
 * presents a room token, and gets exactly nothing until the host approves it.
 *
 * Deliberately not a unit test — the property worth protecting spans the
 * server (unknown keys used to be closed), the connection (which dialects a
 * pending guest may speak) and the room store (who mints the grant).
 */

import type { Envelope } from "@argus/remote-protocol";
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import WebSocket from "ws";
import { generateKeypair, NoiseHandshake } from "./noise";

const saved: unknown[] = [];
const renamed: unknown[] = [];
vi.mock("./deviceStore", () => ({
  getDesktopIdentity: async () => ({ priv: IDENTITY.priv, pub: IDENTITY.pub }),
  saveDevice: async (d: unknown) => {
    saved.push(d);
  },
  renameDevice: async (id: string, label: string) => {
    renamed.push({ id, label });
  },
  setDevicePush: async () => {},
  clearDevicePush: async () => {},
  updateLastSeen: async () => {},
  findDeviceByStaticKey: async () => null,
}));
vi.mock("@argus/host/bus", () => ({
  addHostEventSink: () => () => {},
  emitHostEvent: () => {},
}));
vi.mock("../../state", () => ({
  appState: {
    agents: new Map(),
    agentSnapshots: new Map(),
    agentPendingPermissions: new Map(),
    sessions: new Map(),
  },
}));
vi.mock("../agent/agentService", () => ({
  listAgents: () => [],
  respondToPermission: vi.fn(),
  sendAgentMessage: vi.fn(async () => undefined),
}));
vi.mock("../mcp/projects", () => ({ collectAllProjects: () => [] }));
vi.mock("../session/manager", () => ({ listSessions: async () => [] }));
vi.mock("../session/sessionOps", () => ({
  getSessionBranchDiff: async () => "",
  getSessionFullDiff: async () => "",
}));
vi.mock("../simulator/ios", () => ({
  isSimulatorCapturing: () => false,
  listSimulators: async () => [
    { udid: "udid-1", name: "iPhone", runtime: "iOS 18", booted: true },
    { udid: "udid-2", name: "iPad", runtime: "iOS 18", booted: true },
  ],
  simulatorTouch: vi.fn(async () => undefined),
  simulatorButton: vi.fn(async () => undefined),
  simulatorKeyboard: vi.fn(async () => undefined),
  startSimulatorCapture: vi.fn(async () => undefined),
  stopSimulatorCapture: vi.fn(),
  forceStopSimulatorCapture: vi.fn(),
}));
vi.mock("../simulator/android", () => ({
  isAndroidCapturing: () => false,
  listAndroidDevices: async () => [],
  androidTouch: vi.fn(async () => undefined),
  androidButton: vi.fn(async () => undefined),
  androidKeyboard: vi.fn(async () => undefined),
  startAndroidCapture: vi.fn(async () => undefined),
  stopAndroidCapture: vi.fn(),
  forceStopAndroidCapture: vi.fn(),
}));
vi.mock("../simulator/videoForward", () => ({
  onVideo: () => () => undefined,
  getVideoDims: () => null,
}));

const IDENTITY = generateKeypair();

const { startLocalGateway, stopLocalGateway } =
  await import("./localGatewayServer");
const { appState } = await import("../../state");
const { approveGuest, createRoom, denyGuest, endRoom, resetRooms } =
  await import("./huddle");

const enc = new TextEncoder();
const dec = new TextDecoder();
const TAG_JSON = 0x00;

let url: string;

interface Reply {
  ok?: unknown;
  error?: { code: string; message: string };
}

/** A browser opening the link: an ephemeral key, a handshake, then requests. */
class GuestClient {
  private ws!: WebSocket;
  private session: ReturnType<NoiseHandshake["session"]> | null = null;
  private seq = 0;
  private nextId = 1;
  private readonly pending = new Map<string, (r: Reply) => void>();
  readonly events: Envelope[] = [];
  closed = false;
  readonly key = generateKeypair();

  get pub(): string {
    return Buffer.from(this.key.pub).toString("base64");
  }

  async connect(): Promise<void> {
    const hs = new NoiseHandshake({
      role: "initiator",
      staticKey: this.key,
      remoteStatic: IDENTITY.pub,
    });
    this.ws = new WebSocket(`${url}/device`);
    this.ws.binaryType = "arraybuffer";
    const open = new Promise<void>((resolve, reject) => {
      this.ws.on("open", () => {
        this.ws.send(hs.writeMessage(new Uint8Array(0)));
      });
      this.ws.on("close", () => {
        this.closed = true;
        reject(new Error("closed"));
      });
      this.ws.on("error", () => {});
      this.ws.on("message", (raw: WebSocket.RawData) => {
        const bytes = new Uint8Array(raw as Buffer);
        if (!this.session) {
          hs.readMessage(bytes);
          this.session = hs.session();
          resolve();

          return;
        }
        const env = JSON.parse(
          dec.decode(this.session.decrypt(bytes).subarray(1)),
        ) as Envelope & Reply;
        if (env.type === "res") {
          this.pending.get(env.id)?.(env);
        } else {
          this.events.push(env);
        }
      });
    });
    await open;
  }

  async call(method: string, params: unknown = {}): Promise<Reply> {
    const id = `r${String(this.nextId++)}`;
    const env = { type: "req", seq: this.seq++, id, method, params };
    const json = enc.encode(JSON.stringify(env));
    const plain = new Uint8Array(1 + json.length);
    plain[0] = TAG_JSON;
    plain.set(json, 1);
    const reply = new Promise<Reply>((resolve) =>
      this.pending.set(id, resolve),
    );
    this.ws.send(this.session!.encrypt(plain));

    return await reply;
  }

  close(): void {
    this.ws.close();
  }
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

/** Every method a guest could hope to reach, one of each scope rule. */
const SCOPED_CALLS: [string, unknown][] = [
  ["agents.list", {}],
  ["agents.status", { agent_id: "ag1" }],
  ["agents.transcript", { agent_id: "ag1" }],
  ["agents.send", { agent_id: "ag1", text: "hi" }],
  [
    "permission.respond",
    { agent_id: "ag1", tool_use_id: "t1", decision: "allow" },
  ],
  ["devices.list", {}],
  ["devices.claim", { device_id: "udid-1" }],
  [
    "devices.touch",
    { device_id: "udid-1", platform: "ios", phase: "down", x: 1, y: 1 },
  ],
  ["projects.list", {}],
];

const room = () =>
  createRoom({ agent_id: "ag1", device_key: "udid-1", ttl_ms: 60_000 });

describe("joining a huddle", () => {
  beforeAll(async () => {
    const port = await startLocalGateway(0, {
      priv: IDENTITY.priv,
      pub: IDENTITY.pub,
    });
    url = `ws://127.0.0.1:${port}`;
    appState.agents.set("ag1", agentFixture("ag1", "s1"));
    appState.agents.set("ag2", agentFixture("ag2", "s2"));
  });

  afterEach(() => {
    resetRooms();
    saved.length = 0;
    renamed.length = 0;
  });
  afterAll(() => stopLocalGateway());

  it("closes an unknown key when no room is open", async () => {
    const guest = new GuestClient();

    await expect(guest.connect()).rejects.toThrow();
  });

  it("gives a valid token a pending connection and nothing else", async () => {
    const r = room();
    const guest = new GuestClient();
    await guest.connect();

    const join = await guest.call("huddle.join", {
      token: r.token,
      label: "Ana",
    });

    expect(join.ok).toEqual({
      room_id: r.id,
      state: "pending",
      agent_id: null,
      device_key: null,
      // Not even who else is in the room — that's the host's to announce.
      members: [],
      you: null,
    });

    for (const [method, params] of SCOPED_CALLS) {
      const res = await guest.call(method, params);

      expect([method, res.error?.code]).toEqual([method, "capability_denied"]);
    }

    guest.close();
  });

  it("publishes the host key only while a room is open", async () => {
    const keyUrl = `${url.replace("ws://", "http://")}/huddle/host-key`;

    expect((await fetch(keyUrl)).status).toBe(404);

    room();
    const res = await fetch(keyUrl);

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({
      ds_pub: Buffer.from(IDENTITY.pub).toString("base64"),
    });
  });

  it("refuses an unknown token outright", async () => {
    room();
    const guest = new GuestClient();
    await guest.connect();

    expect(
      (await guest.call("huddle.join", { token: "wrong" })).error,
    ).toMatchObject({ code: "not_found" });

    guest.close();
  });

  it("refuses everything to a guest that never joined", async () => {
    room();
    const guest = new GuestClient();
    await guest.connect();

    for (const [method, params] of SCOPED_CALLS) {
      expect((await guest.call(method, params)).error?.code).toBe(
        "capability_denied",
      );
    }
    expect((await guest.call("huddle.state")).error?.code).toBe("not_found");

    guest.close();
  });

  it("serves the room's agent and device once the host approves", async () => {
    const r = room();
    const guest = new GuestClient();
    await guest.connect();
    await guest.call("huddle.join", { token: r.token, label: "Ana" });

    expect(approveGuest(r.id, guest.pub)).toBe(true);

    const status = await guest.call("agents.status", { agent_id: "ag1" });

    expect(status.ok).toMatchObject({ agent: { agent_id: "ag1" } });

    const devices = (await guest.call("devices.list")).ok as {
      devices: { id: string }[];
    };

    expect(devices.devices.map((d) => d.id)).toEqual(["udid-1"]);

    // …and nothing outside the room, even though the grant is now control-tier.
    expect(
      (await guest.call("agents.status", { agent_id: "ag2" })).error?.code,
    ).toBe("capability_denied");
    expect(
      (await guest.call("devices.claim", { device_id: "udid-2" })).error?.code,
    ).toBe("capability_denied");
    // Creating things is never a guest's call, in or out of scope.
    expect(
      (await guest.call("sessions.create", { repo_root: "/r", name: "x" }))
        .error?.code,
    ).toBe("capability_denied");
    // Admin is stripped from a scoped grant, so the raw passthrough is shut.
    expect((await guest.call("list_projects", {})).error?.code).toBe(
      "capability_denied",
    );

    guest.close();
  });

  it("tells the guest it was approved", async () => {
    const r = room();
    const guest = new GuestClient();
    await guest.connect();
    await guest.call("huddle.join", { token: r.token, label: "Ana" });
    approveGuest(r.id, guest.pub);

    await vi.waitFor(() =>
      expect(
        guest.events.some(
          (e) => (e as { event?: string }).event === "huddle.state",
        ),
      ).toBe(true),
    );
    expect((await guest.call("huddle.state")).ok).toMatchObject({
      state: "approved",
      agent_id: "ag1",
      device_key: "udid-1",
    });

    guest.close();
  });

  it("never writes a guest key to the device store", async () => {
    const r = room();
    const guest = new GuestClient();
    await guest.connect();
    await guest.call("huddle.join", { token: r.token, label: "Ana" });
    approveGuest(r.id, guest.pub);
    await guest.call("device.rename", { name: "Sneaky" });

    expect(saved).toEqual([]);
    // The rename reaches the store keyed by an id it has never heard of, so it
    // is a no-op there — a guest can never become adopted hardware.
    expect(renamed).toEqual([
      { id: expect.stringMatching(/^guest:/), label: "Sneaky" },
    ]);

    guest.close();
  });

  it("runs two guests in one room", async () => {
    const r = room();
    const ana = new GuestClient();
    const bo = new GuestClient();
    await ana.connect();
    await bo.connect();
    await ana.call("huddle.join", { token: r.token, label: "Ana" });
    await bo.call("huddle.join", { token: r.token, label: "Bo" });
    approveGuest(r.id, ana.pub);

    expect(
      (await ana.call("agents.status", { agent_id: "ag1" })).ok,
    ).toBeTruthy();
    expect(
      (await bo.call("agents.status", { agent_id: "ag1" })).error?.code,
    ).toBe("capability_denied");

    approveGuest(r.id, bo.pub);

    expect(
      (await bo.call("agents.status", { agent_id: "ag1" })).ok,
    ).toBeTruthy();

    ana.close();
    bo.close();
  });

  it("drops a denied guest's socket", async () => {
    const r = room();
    const guest = new GuestClient();
    await guest.connect();
    await guest.call("huddle.join", { token: r.token, label: "Ana" });
    denyGuest(r.id, guest.pub);

    await vi.waitFor(() => expect(guest.closed).toBe(true));
  });

  it("drops every guest when the room ends", async () => {
    const r = room();
    const ana = new GuestClient();
    const bo = new GuestClient();
    await ana.connect();
    await bo.connect();
    await ana.call("huddle.join", { token: r.token, label: "Ana" });
    await bo.call("huddle.join", { token: r.token, label: "Bo" });
    approveGuest(r.id, ana.pub);
    endRoom(r.id);

    await vi.waitFor(() => {
      expect(ana.closed).toBe(true);
      expect(bo.closed).toBe(true);
    });
  });
});
