/**
 * Steady-state client transport: connects to a host gateway's `/device`
 * endpoint, runs the Noise IK initiator handshake against the pinned host key,
 * then exposes request/response plus event and media delivery over the
 * encrypted channel. No rooms — the host identifies the device by its static
 * key.
 *
 * Shared by the LAN web client and the desktop's remote mode, which differ only
 * in what they do with the events.
 */

import { fromBase64, fromUtf8, toUtf8 } from "./base64";
import {
  TAG_MEDIA,
  TAG_JSON,
  TAG_XFER,
  type Envelope,
  type EventEnvelope,
  type ResponseEnvelope,
} from "./envelopes";
import {
  type ExternalStaticKey,
  NoiseHandshake,
  type NoiseSession,
} from "./noise";
import { GatewaySocket } from "./socket";

export type ConnectionState =
  | "connecting"
  | "handshaking"
  | "offline"
  | "ready";

/**
 * A static key held by a keystore that only answers asynchronously, such as a
 * non-extractable WebCrypto X25519 key. Takes the place of `devPrivB64`.
 */
export interface AsyncStaticKey {
  pub: Uint8Array;
  dh: (remotePub: Uint8Array) => Promise<Uint8Array>;
}

/** Everything needed to reach one host and prove who we are to it. */
export interface HostCredentials {
  /** `ws://` or `wss://` origin of the host gateway. */
  url: string;
  /** This device's Noise static keypair, base64. */
  devPrivB64: string;
  devPubB64: string;
  /** The host's pinned static public key, base64. */
  hostPubB64: string;
  /** Used instead of `devPrivB64`/`devPubB64` when present. */
  staticKey?: AsyncStaticKey;
}

const hex = (bytes: Uint8Array): string =>
  Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");

/**
 * Noise asks for DH results synchronously; an async key computes each one
 * first and this answers from what was computed.
 */
class PrecomputedStaticKey implements ExternalStaticKey {
  private readonly shared = new Map<string, Uint8Array>();

  constructor(private readonly key: AsyncStaticKey) {}

  get pub(): Uint8Array {
    return this.key.pub;
  }

  async prepare(remotePub: Uint8Array): Promise<void> {
    this.shared.set(hex(remotePub), await this.key.dh(remotePub));
  }

  dh(remotePub: Uint8Array): Uint8Array {
    const found = this.shared.get(hex(remotePub));
    if (!found) {
      throw new Error("static key DH was not prepared");
    }

    return found;
  }
}

export interface TransportHandlers {
  onState: (state: ConnectionState) => void;
  onEvent: (event: EventEnvelope) => void;
  /** Binary device-screen frame (after the media tag byte). */
  onMedia?: (bytes: Uint8Array) => void;
  /** Binary transfer message (after the transfer tag byte). */
  onXfer?: (bytes: Uint8Array) => void;
}

export class RemoteError extends Error {
  constructor(
    readonly code: string,
    message: string,
    /** Structured payload the host attached (e.g. a serialised GitError). */
    readonly data?: unknown,
  ) {
    super(message);
    this.name = "RemoteError";
  }
}

export interface TransportOptions {
  /** How long a request waits for its response before rejecting. */
  requestTimeoutMs?: number;
}

export class Transport {
  private readonly socket: GatewaySocket;
  private hs: NoiseHandshake | null = null;
  private session: NoiseSession | null = null;
  /** Set while dialling with an async key: frames wait their turn behind DH. */
  private asyncKey: PrecomputedStaticKey | null = null;
  private inbox: Promise<void> = Promise.resolve();
  /** Bumped on every reset, so a DH that lands after a drop is discarded. */
  private generation = 0;
  private sendSeq = 0;
  private recvSeq = -1;
  private readonly timeoutMs: number;
  private readonly pending = new Map<string, (res: ResponseEnvelope) => void>();
  /** Agent ids to resubscribe after a reconnect — the host forgets them. */
  private readonly subscriptions = new Set<string>();

  constructor(
    private readonly credentials: HostCredentials,
    private readonly handlers: TransportHandlers,
    options: TransportOptions = {},
  ) {
    this.timeoutMs = options.requestTimeoutMs ?? 15_000;
    this.socket = new GatewaySocket(`${credentials.url}/device`, {
      onOpen: () => this.startHandshake(),
      onFrame: (bytes) => this.onFrame(bytes),
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
    this.subscriptions.clear();
    this.reset();
  }

  get connected(): boolean {
    return this.session !== null;
  }

  private reset(): void {
    this.generation += 1;
    this.inbox = Promise.resolve();
    this.hs = null;
    this.session = null;
    this.sendSeq = 0;
    this.recvSeq = -1;
    for (const [id, resolve] of this.pending) {
      resolve({
        type: "res",
        seq: -1,
        id,
        error: { code: "disconnected", message: "connection lost" },
      });
    }
    this.pending.clear();
  }

  private startHandshake(): void {
    this.handlers.onState("handshaking");
    const remoteStatic = fromBase64(this.credentials.hostPubB64);
    if (this.credentials.staticKey) {
      const key = new PrecomputedStaticKey(this.credentials.staticKey);
      const generation = this.generation;
      this.asyncKey = key;
      // `ss` needs DH(s, rs) while writing the first message.
      this.inbox = key.prepare(remoteStatic).then(
        () => {
          if (generation !== this.generation) {
            return;
          }
          this.hs = new NoiseHandshake({
            role: "initiator",
            staticKey: key,
            remoteStatic,
          });
          this.socket.send(this.hs.writeMessage(new Uint8Array(0)));
        },
        () => {
          if (generation === this.generation) {
            this.reset();
            this.handlers.onState("offline");
          }
        },
      );

      return;
    }
    this.hs = new NoiseHandshake({
      role: "initiator",
      staticKey: {
        priv: fromBase64(this.credentials.devPrivB64),
        pub: fromBase64(this.credentials.devPubB64),
      },
      remoteStatic,
    });
    this.socket.send(this.hs.writeMessage(new Uint8Array(0)));
  }

  private onFrame(bytes: Uint8Array): void {
    if (!this.asyncKey) {
      this.onData(bytes);

      return;
    }
    const key = this.asyncKey;
    const generation = this.generation;
    // `se` needs DH(s, re) before the reply can be read; `re` is its first 32 bytes.
    this.inbox = this.inbox
      .then(async () => {
        if (!this.session && this.hs && bytes.length >= 32) {
          await key.prepare(bytes.subarray(0, 32));
        }
      })
      .then(() => {
        if (generation === this.generation) {
          this.onData(bytes);
        }
      })
      .catch(() => {
        if (generation === this.generation) {
          this.reset();
          this.handlers.onState("offline");
        }
      });
  }

  private onData(bytes: Uint8Array): void {
    if (!this.session) {
      if (!this.hs) {
        return;
      }
      try {
        this.hs.readMessage(bytes);
        this.session = this.hs.session();
        for (const agentId of this.subscriptions) {
          this.emitSubscribe(agentId, true);
        }
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
    if (plain[0] === TAG_XFER) {
      this.handlers.onXfer?.(plain.subarray(1));

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

  request<T = unknown>(method: string, params: unknown): Promise<T> {
    if (!this.session) {
      return Promise.reject(new RemoteError("offline", "not connected"));
    }
    const id = `r${String(this.sendSeq)}`;
    const env: Envelope = {
      type: "req",
      seq: this.sendSeq++,
      id,
      method,
      params,
    };

    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new RemoteError("timeout", `${method} timed out`));
      }, this.timeoutMs);
      this.pending.set(id, (res) => {
        clearTimeout(timer);
        if (res.error) {
          reject(
            new RemoteError(res.error.code, res.error.message, res.error.data),
          );
        } else {
          resolve(res.ok as T);
        }
      });
      this.emit(env);
    });
  }

  /** Send one transfer message body on the encrypted channel. */
  sendXfer(body: Uint8Array): void {
    if (!this.session) {
      return;
    }
    const plain = new Uint8Array(1 + body.length);
    plain[0] = TAG_XFER;
    plain.set(body, 1);
    this.socket.send(this.session.encrypt(plain));
  }

  /** Bytes queued on the socket — transfers pause on this rather than drop. */
  get bufferedAmount(): number {
    return this.socket.bufferedAmount;
  }

  private emitSubscribe(agentId: string, on: boolean): void {
    this.emit({
      type: "sub",
      seq: this.sendSeq++,
      action: on ? "subscribe" : "unsubscribe",
      agent_id: agentId,
    });
  }

  subscribe(agentId: string, on: boolean): void {
    if (on) {
      this.subscriptions.add(agentId);
    } else {
      this.subscriptions.delete(agentId);
    }
    this.emitSubscribe(agentId, on);
  }
}
