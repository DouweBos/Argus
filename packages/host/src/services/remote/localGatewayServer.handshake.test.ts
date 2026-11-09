import type { DesktopIdentity, PairedDevice } from "./deviceStore";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import WebSocket from "ws";
import { generateKeypair, NoiseHandshake } from "./noise";

const DEVICES: PairedDevice[] = [];
const gatewayMock = vi.hoisted(() => ({
  added: 0,
  removed: 0,
}));
vi.mock("@argus/host/bus", () => ({
  addHostEventSink: () => () => {},
  emitHostEvent: () => {},
}));
vi.mock("./deviceStore", () => ({
  findDeviceByStaticKey: async (pub: string) =>
    DEVICES.find((d) => d.dev_static_pub === pub) ?? null,
  updateLastSeen: vi.fn(async () => {}),
}));
vi.mock("../account/lifecycle", () => ({
  findAccountDeviceFresh: async () => null,
  syncSoon: () => {},
}));
vi.mock("../account/trust", () => ({
  accountAllowsDevice: () => true,
  currentState: () => null,
}));
vi.mock("../telemetry/telemetry", () => ({ capture: () => {} }));
vi.mock("./huddle", () => ({ hasOpenRooms: () => false }));
vi.mock("./gateway", () => ({
  DeviceConnection: class {
    setCloser(): void {}
    setBufferedProbe(): void {}
    isUnjoinedGuest(): boolean {
      return false;
    }
    async onFrame(): Promise<void> {}
  },
  createGuestConnection: () => {
    throw new Error("no guests in this test");
  },
  addConnection: () => {
    gatewayMock.added += 1;
  },
  removeConnection: () => {
    gatewayMock.removed += 1;
  },
}));

const { startLocalGateway, stopLocalGateway } =
  await import("./localGatewayServer");

const desktop = generateKeypair();
const identity: DesktopIdentity = { priv: desktop.priv, pub: desktop.pub };
let url: string;

function enroll(pub: Uint8Array): void {
  DEVICES.push({
    device_id: `dev-${DEVICES.length}`,
    label: "Test",
    dev_static_pub: Buffer.from(pub).toString("base64"),
    capabilities: ["monitor"],
    created_at: 0,
    last_seen: null,
  });
}

function handshakeMessage(client: ReturnType<typeof generateKeypair>) {
  return new NoiseHandshake({
    role: "initiator",
    staticKey: client,
    remoteStatic: desktop.pub,
  }).writeMessage(new Uint8Array(0));
}

function open(
  path: string,
  headers: Record<string, string> = {},
): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`${url}${path}`, { headers });
    ws.once("open", () => resolve(ws));
    ws.once("error", reject);
  });
}

/** Frames received before the server closed the socket. */
function framesUntilClose(ws: WebSocket): Promise<number> {
  let frames = 0;
  ws.on("message", () => {
    frames += 1;
  });

  return new Promise((resolve) => ws.once("close", () => resolve(frames)));
}

describe("local gateway pre-auth handshake", () => {
  beforeEach(async () => {
    gatewayMock.added = 0;
    gatewayMock.removed = 0;
    const port = await startLocalGateway(0, identity);
    url = `ws://127.0.0.1:${port}`;
  });

  afterEach(() => stopLocalGateway());

  it("drops a socket that sends a second handshake before the reply", async () => {
    const client = generateKeypair();
    enroll(client.pub);
    const ws = await open("/device");
    const closed = framesUntilClose(ws);
    ws.send(handshakeMessage(client));
    ws.send(handshakeMessage(client));

    await expect(closed).resolves.toBe(0);
    expect(gatewayMock.added).toBe(0);
  });

  it("still connects a paired device that sends one handshake", async () => {
    const client = generateKeypair();
    enroll(client.pub);
    const ws = await open("/device");
    const reply = new Promise((resolve) => ws.once("message", resolve));
    ws.send(handshakeMessage(client));

    await expect(reply).resolves.toBeDefined();
    expect(gatewayMock.added).toBe(1);
    ws.close();
  });
});
