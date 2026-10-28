import { x25519 } from "@noble/curves/ed25519.js";
import { afterEach, describe, expect, it, vi } from "vitest";
import { toBase64 } from "./base64";
import { TAG_JSON } from "./envelopes";
import { generateKeypair, NoiseHandshake, type NoiseSession } from "./noise";
import { type ConnectionState, Transport } from "./transport";

/** A gateway on the other end of a fake socket: answers the handshake, then talks first. */
class FakeGatewaySocket {
  static host = generateKeypair();
  static last: FakeGatewaySocket | null = null;
  readyState = 0;
  binaryType = "";
  onopen: (() => void) | null = null;
  onmessage: ((ev: { data: ArrayBuffer }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  session: NoiseSession | null = null;
  private readonly hs = new NoiseHandshake({
    role: "responder",
    staticKey: FakeGatewaySocket.host,
  });

  constructor(readonly url: string) {
    FakeGatewaySocket.last = this;
    queueMicrotask(() => {
      this.readyState = 1;
      this.onopen?.();
    });
  }

  send(bytes: Uint8Array): void {
    if (this.session) {
      return;
    }
    this.hs.readMessage(bytes);
    const reply = this.hs.writeMessage(new Uint8Array(0));
    this.session = this.hs.session();
    const json = new TextEncoder().encode(
      JSON.stringify({ type: "evt", seq: 0, event: "hello", payload: {} }),
    );
    const plain = new Uint8Array(1 + json.length);
    plain[0] = TAG_JSON;
    plain.set(json, 1);
    // Both frames land back to back, before the browser's DH resolves.
    this.deliver(reply);
    this.deliver(this.session.encrypt(plain));
  }

  private deliver(bytes: Uint8Array): void {
    this.onmessage?.({ data: bytes.slice().buffer });
  }

  close(): void {
    this.onclose?.();
  }
}

describe("transport with an async static key", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("completes the handshake and keeps frames in order behind the DH", async () => {
    vi.stubGlobal("WebSocket", Object.assign(FakeGatewaySocket, { OPEN: 1 }));
    const device = generateKeypair();
    const states: ConnectionState[] = [];
    const events: string[] = [];
    const transport = new Transport(
      {
        url: "wss://argus-test.example",
        devPrivB64: "",
        devPubB64: "",
        hostPubB64: toBase64(FakeGatewaySocket.host.pub),
        staticKey: {
          pub: device.pub,
          dh: async (remote) => {
            await new Promise((resolve) => setTimeout(resolve, 5));

            return x25519.getSharedSecret(device.priv, remote);
          },
        },
      },
      {
        onState: (s) => states.push(s),
        onEvent: (e) => events.push((e as { event: string }).event),
      },
    );
    transport.connect();
    await vi.waitFor(() => expect(events).toEqual(["hello"]));

    expect(states).toEqual(["connecting", "handshaking", "ready"]);
    expect(FakeGatewaySocket.last?.url).toBe("wss://argus-test.example/device");
    transport.disconnect();
  });
});
