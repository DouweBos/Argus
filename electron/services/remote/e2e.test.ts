import type { PairedDevice, DesktopIdentity } from "./deviceStore";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import WebSocket from "ws";
import { generateKeypair, NoiseHandshake } from "./noise";

// Real gateway dispatch over the real local WS server, but stub the
// electron-bound service layer + broadcast + device lookup.
const DEVICES: PairedDevice[] = [];
vi.mock("../../broadcast", () => ({
  addBroadcastTap: () => () => {},
  broadcastToRenderers: () => {},
}));
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
vi.mock("./deviceStore", () => ({
  findDeviceByStaticKey: async (pub: string) =>
    DEVICES.find((d) => d.dev_static_pub === pub) ?? null,
  updateLastSeen: vi.fn(async () => {}),
}));

const { startLocalGateway, stopLocalGateway } =
  await import("./localGatewayServer");

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
const desktop = generateKeypair();
const identity: DesktopIdentity = { priv: desktop.priv, pub: desktop.pub };
let url: string;

/** Direct-WS client: connects to /device, does IK, exposes request(). */
class TestClient {
  private ws!: WebSocket;
  private hs: NoiseHandshake;
  private session: ReturnType<NoiseHandshake["session"]> | null = null;
  private seq = 0;
  private readonly pending = new Map<string, (v: unknown) => void>();
  private onReady!: () => void;
  readonly ready: Promise<void>;

  constructor(client: ReturnType<typeof generateKeypair>) {
    this.hs = new NoiseHandshake({
      role: "initiator",
      staticKey: client,
      remoteStatic: desktop.pub,
    });
    this.ready = new Promise((r) => (this.onReady = r));
  }

  connect(): Promise<void> {
    return new Promise((resolve) => {
      this.ws = new WebSocket(`${url}/device`);
      this.ws.binaryType = "arraybuffer";
      this.ws.on("open", () => {
        this.ws.send(this.hs.writeMessage(new Uint8Array(0)));
        resolve();
      });
      this.ws.on("message", (raw: WebSocket.RawData) => {
        const bytes = new Uint8Array(raw as Buffer);
        if (!this.session) {
          this.hs.readMessage(bytes);
          this.session = this.hs.session();
          this.onReady();
        } else {
          const env = unframeJson(this.session.decrypt(bytes)) as {
            id: string;
            type: string;
          };
          if (env.type === "res") {
            this.pending.get(env.id)?.(env);
          }
        }
      });
    });
  }

  request(
    method: string,
    params: unknown,
  ): Promise<{ ok?: unknown; error?: unknown }> {
    const id = `r${this.seq}`;
    const env = { type: "req", seq: this.seq++, id, method, params };
    const p = new Promise<{ ok?: unknown; error?: unknown }>((resolve) =>
      this.pending.set(id, resolve as (v: unknown) => void),
    );
    this.ws.send(this.session!.encrypt(frameJson(env)));

    return p;
  }

  close(): void {
    this.ws.close();
  }
}

function enroll(pub: Uint8Array): PairedDevice {
  const device: PairedDevice = {
    device_id: `dev-${DEVICES.length}`,
    label: "Test",
    dev_static_pub: Buffer.from(pub).toString("base64"),
    capabilities: ["monitor"],
    created_at: 0,
    last_seen: null,
  };
  DEVICES.push(device);

  return device;
}

describe("remote access end-to-end (local gateway server)", () => {
  beforeAll(async () => {
    const port = await startLocalGateway(0, identity); // 0 → OS-assigned port
    url = `ws://127.0.0.1:${port}`;
  });

  afterAll(() => stopLocalGateway());

  it("a paired client calls a monitor method through the encrypted tunnel", async () => {
    const client = generateKeypair();
    enroll(client.pub);
    const c = new TestClient(client);
    await c.connect();
    await c.ready;

    const res = await c.request("projects.list", {});
    expect((res.ok as { projects: unknown[] }).projects).toHaveLength(1);

    const denied = await c.request("write_session_file", { path: "/x" });
    expect((denied.error as { code: string }).code).toBe("capability_denied");

    c.close();
  });

  it("drops a client whose static key is not enrolled", async () => {
    const impostor = generateKeypair(); // never enrolled
    const c = new TestClient(impostor);
    await c.connect();
    const outcome = await Promise.race([
      c.ready.then(() => "ready"),
      new Promise((r) => setTimeout(() => r("timeout"), 500)),
    ]);
    expect(outcome).toBe("timeout");
    c.close();
  });
});
