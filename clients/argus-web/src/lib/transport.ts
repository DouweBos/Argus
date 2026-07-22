/**
 * Steady-state client transport: connects directly to the desktop gateway's
 * `/device` endpoint (via the tunnel), runs the Noise IK initiator handshake
 * against the pinned desktop key, then exposes request/response + event
 * subscription over the encrypted channel. No rooms — the desktop identifies
 * this device by its static key.
 */

import { NoiseHandshake, type NoiseSession } from "../crypto/noise";
import { fromBase64, fromUtf8, toUtf8 } from "./base64";
import { keypairFromIdentity, type DeviceIdentity } from "./keystore";
import { wsOrigin } from "./origin";
import type {
  Envelope,
  EventEnvelope,
  RemoteMethod,
  ResponseEnvelope,
} from "./protocol";
import { GatewaySocket } from "./socket";

export type ConnectionState = "connecting" | "handshaking" | "offline" | "ready";

/** Plaintext tag distinguishing JSON envelopes from binary media frames. */
const TAG_JSON = 0x00;
const TAG_MEDIA = 0x01;

export interface TransportHandlers {
  onState: (state: ConnectionState) => void;
  onEvent: (event: EventEnvelope) => void;
  /** Binary device-screen frame (after the media tag byte). */
  onMedia?: (bytes: Uint8Array) => void;
}

export class Transport {
  private socket: GatewaySocket;
  private hs: NoiseHandshake | null = null;
  private session: NoiseSession | null = null;
  private sendSeq = 0;
  private recvSeq = -1;
  private readonly pending = new Map<string, (res: ResponseEnvelope) => void>();

  constructor(
    private readonly identity: DeviceIdentity,
    private readonly handlers: TransportHandlers,
  ) {
    this.socket = new GatewaySocket(`${wsOrigin()}/device`, {
      onOpen: () => this.startHandshake(),
      onFrame: (bytes) => this.onData(bytes),
      onClose: () => {
        this.reset();
        this.handlers.onState("offline");
      },
    });
  }

  connect(): void {
    this.handlers.onState("connecting");
    this.socket.connect();
  }

  disconnect(): void {
    this.socket.close();
    this.reset();
  }

  private reset(): void {
    this.hs = null;
    this.session = null;
    this.sendSeq = 0;
    this.recvSeq = -1;
  }

  private startHandshake(): void {
    this.handlers.onState("handshaking");
    this.hs = new NoiseHandshake({
      role: "initiator",
      staticKey: keypairFromIdentity(this.identity),
      remoteStatic: fromBase64(this.identity.desktopPubB64),
    });
    this.socket.send(this.hs.writeMessage(new Uint8Array(0)));
  }

  private onData(bytes: Uint8Array): void {
    if (!this.session) {
      if (!this.hs) {
        return;
      }
      try {
        this.hs.readMessage(bytes);
        this.session = this.hs.session();
        this.handlers.onState("ready");
      } catch {
        this.reset();
        this.handlers.onState("offline");
      }

      return;
    }
    let plain: Uint8Array;
    try {
      plain = this.session.decrypt(bytes);
    } catch {
      return;
    }
    if (plain.length === 0) {
      return;
    }
    if (plain[0] === TAG_MEDIA) {
      this.handlers.onMedia?.(plain.subarray(1));

      return;
    }
    let env: Envelope;
    try {
      env = JSON.parse(toUtf8(plain.subarray(1))) as Envelope;
    } catch {
      return;
    }
    if (env.seq <= this.recvSeq) {
      return;
    }
    this.recvSeq = env.seq;
    if (env.type === "res") {
      this.pending.get(env.id)?.(env);
      this.pending.delete(env.id);
    } else if (env.type === "evt") {
      this.handlers.onEvent(env);
    }
  }

  private emit(env: Envelope): void {
    if (this.session) {
      const json = fromUtf8(JSON.stringify(env));
      const plain = new Uint8Array(1 + json.length);
      plain[0] = TAG_JSON;
      plain.set(json, 1);
      this.socket.send(this.session.encrypt(plain));
    }
  }

  request<T = unknown>(method: RemoteMethod, params: unknown): Promise<T> {
    const id = `r${this.sendSeq}`;
    const env: Envelope = { type: "req", seq: this.sendSeq++, id, method, params };

    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error("request timed out"));
      }, 15_000);
      this.pending.set(id, (res) => {
        clearTimeout(timer);
        if (res.error) {
          reject(new Error(res.error.message));
        } else {
          resolve(res.ok as T);
        }
      });
      this.emit(env);
    });
  }

  subscribe(agentId: string, on: boolean): void {
    this.emit({
      type: "sub",
      seq: this.sendSeq++,
      action: on ? "subscribe" : "unsubscribe",
      agent_id: agentId,
    });
  }
}
