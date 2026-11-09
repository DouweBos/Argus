import type { DesktopIdentity, PairedDevice } from "./deviceStore";
import type { HandshakeRate } from "./localGatewayServer";
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

const {
  isAllowedOrigin,
  setPairingHandler,
  startLocalGateway,
  stopLocalGateway,
} = await import("./localGatewayServer");

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

async function start(handshakeRate?: HandshakeRate): Promise<void> {
  const port = await startLocalGateway(0, identity, {
    host: "127.0.0.1",
    staticDir: null,
    handshakeRate,
  });
  url = `ws://127.0.0.1:${port}`;
}

/** Whether the server answered a paired device's handshake before closing. */
async function deviceAnswered(): Promise<boolean> {
  const client = generateKeypair();
  enroll(client.pub);
  const ws = await open("/device");
  const outcome = new Promise<boolean>((resolve) => {
    ws.once("message", () => resolve(true));
    ws.once("close", () => resolve(false));
  });
  ws.send(handshakeMessage(client));
  const answered = await outcome;
  ws.close();

  return answered;
}

describe("local gateway handshakes", () => {
  beforeEach(() => {
    gatewayMock.added = 0;
    gatewayMock.removed = 0;
  });

  afterEach(() => {
    setPairingHandler(null);
    stopLocalGateway();
  });

  describe("local gateway pre-auth handshake", () => {
    beforeEach(() => start());

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

  describe("handshake rate limit", () => {
    it("refuses /device handshakes once the budget is spent", async () => {
      await start({ burst: 2, perSecond: 0 });

      await expect(deviceAnswered()).resolves.toBe(true);
      await expect(deviceAnswered()).resolves.toBe(true);
      await expect(deviceAnswered()).resolves.toBe(false);
    });

    it("refills the budget over time", async () => {
      await start({ burst: 1, perSecond: 50 });

      await expect(deviceAnswered()).resolves.toBe(true);
      await new Promise((r) => setTimeout(r, 60));
      await expect(deviceAnswered()).resolves.toBe(true);
    });

    it("shares one budget across /pair and /device", async () => {
      await start({ burst: 1, perSecond: 0 });
      setPairingHandler({ onData: () => false, onClose: () => {} });
      const pair = await open("/pair");
      const closed = framesUntilClose(pair);
      pair.send(new Uint8Array(48));
      await closed;

      await expect(deviceAnswered()).resolves.toBe(false);
    });

    it("lets a phone dial every route at once", async () => {
      await start();
      const answers = await Promise.all(
        Array.from({ length: 12 }, () => deviceAnswered()),
      );

      expect(answers.every(Boolean)).toBe(true);
    });
  });

  describe("/pair attempts per socket", () => {
    beforeEach(() => start());

    it("drops the socket when the pairing session refuses its handshake", async () => {
      const onData = vi.fn(() => false);
      setPairingHandler({ onData, onClose: () => {} });
      const ws = await open("/pair");
      const closed = framesUntilClose(ws);
      ws.send(new Uint8Array(48));

      await expect(closed).resolves.toBe(0);
      expect(onData).toHaveBeenCalledTimes(1);
    });

    it("drops the socket when no pairing is in progress", async () => {
      const ws = await open("/pair");
      const closed = framesUntilClose(ws);
      ws.send(new Uint8Array(48));

      await expect(closed).resolves.toBe(0);
    });

    it("hands the pairing session only the first frame", async () => {
      const onData = vi.fn((_: Uint8Array, send: (out: Uint8Array) => void) => {
        send(new Uint8Array([1]));

        return true;
      });
      setPairingHandler({ onData, onClose: () => {} });
      const ws = await open("/pair");
      const reply = new Promise((resolve) => ws.once("message", resolve));
      const closed = framesUntilClose(ws);
      ws.send(new Uint8Array(48));
      await reply;
      ws.send(new Uint8Array(48));

      await expect(closed).resolves.toBe(1);
      expect(onData).toHaveBeenCalledTimes(1);
    });
  });

  describe("the upgrade origin check", () => {
    beforeEach(() => start());

    /** Whether the upgrade went through with these headers. */
    async function accepted(
      path: string,
      headers: Record<string, string>,
    ): Promise<boolean> {
      try {
        (await open(path, headers)).close();

        return true;
      } catch {
        return false;
      }
    }

    it("accepts native clients that send no Origin", async () => {
      await expect(accepted("/device", {})).resolves.toBe(true);
    });

    it("accepts the web client served by this gateway", async () => {
      const origin = `http://${new URL(url).host}`;

      await expect(accepted("/device", { Origin: origin })).resolves.toBe(true);
    });

    it("accepts the hosted web client", async () => {
      await expect(
        accepted("/pair", { Origin: "https://houwert.dev" }),
      ).resolves.toBe(true);
    });

    it("refuses a page on another site", async () => {
      await expect(
        open("/device", { Origin: "https://evil.example" }),
      ).rejects.toThrow();
      await expect(
        open("/pair", { Origin: "https://evil.example" }),
      ).rejects.toThrow();
    });
  });

  describe("isAllowedOrigin", () => {
    it.each([
      [undefined, ["127.0.0.1:8787"], true],
      ["https://abc.trycloudflare.com", ["abc.trycloudflare.com"], true],
      ["https://abc.trycloudflare.com", ["abc.trycloudflare.com:443"], true],
      [
        "https://mac.tail1234.ts.net",
        ["127.0.0.1:8787", "mac.tail1234.ts.net"],
        true,
      ],
      ["http://192.168.1.20:8787", ["192.168.1.20:8787"], true],
      ["https://houwert.dev", ["argus-0123.houwert.dev"], true],
      ["http://localhost:5173", ["argus-0123.houwert.dev"], true],
      ["http://[::1]:5173", ["127.0.0.1:8787"], true],
      ["https://evil.example", ["127.0.0.1:8787"], false],
      ["https://houwert.dev.evil.example", ["127.0.0.1:8787"], false],
      ["http://houwert.dev", ["127.0.0.1:8787"], false],
      ["null", ["127.0.0.1:8787"], false],
      ["https://evil.example", [undefined, undefined], false],
    ] as const)("%s against %j → %s", (origin, hosts, allowed) => {
      expect(isAllowedOrigin(origin, [...hosts])).toBe(allowed);
    });
  });
});
