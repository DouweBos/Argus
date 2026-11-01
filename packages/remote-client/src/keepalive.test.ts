import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fromUtf8, toBase64, toUtf8 } from "./base64";
import { TAG_JSON } from "./envelopes";
import { generateKeypair, NoiseHandshake, type NoiseSession } from "./noise";
import { GatewaySocket } from "./socket";
import { type ConnectionState, Transport } from "./transport";

const host = generateKeypair();
const device = generateKeypair();

/** A gateway behind a fake socket that answers requests while `answering`. */
class FakeSocket {
  static all: FakeSocket[] = [];
  static answering = true;
  readyState = 0;
  binaryType = "";
  onopen: (() => void) | null = null;
  onmessage: ((ev: { data: ArrayBuffer }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  requests: string[] = [];
  private session: NoiseSession | null = null;
  private seq = 0;
  private readonly hs = new NoiseHandshake({
    role: "responder",
    staticKey: host,
  });

  constructor(readonly url: string) {
    FakeSocket.all.push(this);
    queueMicrotask(() => {
      this.readyState = 1;
      this.onopen?.();
    });
  }

  send(bytes: Uint8Array): void {
    if (!this.session) {
      this.hs.readMessage(bytes);
      const reply = this.hs.writeMessage(new Uint8Array(0));
      this.session = this.hs.session();
      this.deliver(reply);

      return;
    }
    const plain = this.session.decrypt(bytes);
    const env = JSON.parse(toUtf8(plain.subarray(1))) as {
      type: string;
      id: string;
      method: string;
    };
    if (env.type !== "req") {
      return;
    }
    this.requests.push(env.method);
    if (!FakeSocket.answering) {
      return;
    }
    // An unknown method still answers: that's all a ping needs.
    const res = { type: "res", seq: this.seq++, id: env.id, ok: {} };
    const json = fromUtf8(JSON.stringify(res));
    const out = new Uint8Array(1 + json.length);
    out[0] = TAG_JSON;
    out.set(json, 1);
    this.deliver(this.session.encrypt(out));
  }

  close(): void {
    this.readyState = 3;
    queueMicrotask(() => this.onclose?.());
  }

  private deliver(bytes: Uint8Array): void {
    this.onmessage?.({ data: bytes.slice().buffer });
  }
}

function transport(states: ConnectionState[], intervalMs = 20) {
  return new Transport(
    {
      url: "ws://test",
      devPrivB64: toBase64(device.priv),
      devPubB64: toBase64(device.pub),
      hostPubB64: toBase64(host.pub),
    },
    { onState: (s) => states.push(s), onEvent: () => {} },
    { keepalive: { method: "host.ping", intervalMs, timeoutMs: 30 } },
  );
}

describe("a gateway connection", () => {
  beforeEach(() => {
    FakeSocket.all = [];
    FakeSocket.answering = true;
    vi.stubGlobal("WebSocket", Object.assign(FakeSocket, { OPEN: 1 }));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe("keepalive", () => {
    it("pings while the channel is up and keeps a socket that answers", async () => {
      const states: ConnectionState[] = [];
      const t = transport(states);
      t.connect();
      await vi.waitFor(() =>
        expect(FakeSocket.all[0]?.requests.length).toBeGreaterThanOrEqual(2),
      );

      expect(FakeSocket.all[0].requests.every((m) => m === "host.ping")).toBe(
        true,
      );
      expect(FakeSocket.all).toHaveLength(1);
      expect(states.at(-1)).toBe("ready");
      t.disconnect();
    });

    it("drops a socket that stops answering and dials a fresh one", async () => {
      const states: ConnectionState[] = [];
      const t = transport(states);
      t.connect();
      await vi.waitFor(() => expect(states).toContain("ready"));

      FakeSocket.answering = false;
      await vi.waitFor(() => expect(states).toContain("offline"), {
        timeout: 1000,
      });
      FakeSocket.answering = true;
      await vi.waitFor(() => expect(FakeSocket.all).toHaveLength(2), {
        timeout: 2000,
      });
      await vi.waitFor(() => expect(states.at(-1)).toBe("ready"));
      t.disconnect();
    });

    it("checks right away when asked, instead of at the next interval", async () => {
      const states: ConnectionState[] = [];
      const t = transport(states, 60_000);
      t.connect();
      await vi.waitFor(() => expect(states).toContain("ready"));

      t.checkAlive();
      await vi.waitFor(() =>
        expect(FakeSocket.all[0].requests).toEqual(["host.ping"]),
      );
      t.disconnect();
    });
  });

  describe("the gateway socket", () => {
    it("ignores a replaced socket closing late", async () => {
      let closes = 0;
      const socket = new GatewaySocket("ws://test", {
        onOpen: () => {},
        onFrame: () => {},
        onClose: () => {
          closes += 1;
        },
      });
      socket.connect();
      await vi.waitFor(() => expect(socket.isOpen).toBe(true));
      const first = FakeSocket.all[0];

      socket.drop();
      expect(closes).toBe(1);
      // The dead socket's own close event arrives after we moved on.
      first.onclose?.();
      expect(closes).toBe(1);
      socket.close();
    });

    it("redials at once when the network comes back mid-backoff", async () => {
      const socket = new GatewaySocket("ws://test", {
        onOpen: () => {},
        onFrame: () => {},
        onClose: () => {},
      });
      socket.connect();
      await vi.waitFor(() => expect(socket.isOpen).toBe(true));
      socket.drop();
      expect(FakeSocket.all).toHaveLength(1);

      socket.reconnectNow();
      expect(FakeSocket.all).toHaveLength(2);
      socket.close();
    });
  });
});
