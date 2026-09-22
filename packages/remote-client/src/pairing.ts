/**
 * Client half of pairing: connects to a host gateway's `/pair` endpoint, runs
 * the Noise IKpsk1 initiator handshake, surfaces the SAS for the human to
 * compare, and receives the encrypted grant the host sends after confirmation.
 */

import type {
  PairingClientInfo,
  PairingGrant,
  PairingPayload,
} from "./envelopes";
import { fromBase64Url, fromUtf8, toBase64, toUtf8 } from "./base64";
import { derivePairingPsk, deriveSas } from "./derive";
import { generateKeypair, NoiseHandshake, type NoiseSession } from "./noise";
import { GatewaySocket } from "./socket";

/** A paired host, ready to be persisted and handed to {@link Transport}. */
export interface PairingResult {
  deviceId: string;
  devPrivB64: string;
  devPubB64: string;
  hostPubB64: string;
  url: string;
  capabilities: string[];
}

export interface PairingHandlers {
  onSas: (sas: string) => void;
  onPaired: (result: PairingResult) => void;
  onError: (message: string) => void;
}

/** Parse a scanned QR string or pasted base64url pairing code into a payload. */
export function parsePairingInput(input: string): PairingPayload {
  const trimmed = input.trim();
  const json = trimmed.startsWith("{")
    ? trimmed
    : toUtf8(fromBase64Url(trimmed));
  const payload = JSON.parse(json) as PairingPayload;
  if (payload.v !== 1 || !payload.url || !payload.ds_pub) {
    throw new Error("invalid pairing code");
  }

  return payload;
}

export interface PairingOptions {
  /**
   * Gateway origin to dial. The web client overrides it with its own origin
   * (it is served by the host, so the baked-in URL may be the wrong route in);
   * the desktop uses the URL from the pairing code.
   */
  url?: string;
  /**
   * Who we are, shown on the host's confirm screen. Omitted, the host describes
   * the device as unknown and offers no shortcuts.
   */
  client?: PairingClientInfo;
}

export class PairingClient {
  private readonly socket: GatewaySocket;
  private hs: NoiseHandshake | null = null;
  private session: NoiseSession | null = null;
  private readonly keypair = generateKeypair();
  private readonly url: string;
  private done = false;

  constructor(
    private readonly payload: PairingPayload,
    private readonly handlers: PairingHandlers,
    private readonly options: PairingOptions = {},
  ) {
    this.url = options.url ?? payload.url;
    this.socket = new GatewaySocket(`${this.url}/pair`, {
      onOpen: () => {
        this.hs = new NoiseHandshake({
          role: "initiator",
          staticKey: this.keypair,
          remoteStatic: fromBase64Url(this.payload.ds_pub),
          psk: derivePairingPsk(fromBase64Url(this.payload.pairing_secret)),
        });
        this.socket.send(this.hs.writeMessage(this.identity()));
      },
      onFrame: (bytes) => this.onData(bytes),
      onClose: () => {},
    });
  }

  /** Our identity, as handshake payload bytes. Empty when we were not told. */
  private identity(): Uint8Array {
    const client = this.options.client;

    return client ? fromUtf8(JSON.stringify(client)) : new Uint8Array(0);
  }

  start(): void {
    this.socket.connect();
  }

  cancel(): void {
    this.done = true;
    this.socket.close();
  }

  private onData(bytes: Uint8Array): void {
    if (this.done || !this.hs) {
      return;
    }
    if (!this.session) {
      try {
        this.hs.readMessage(bytes);
        this.session = this.hs.session();
        this.handlers.onSas(deriveSas(this.hs.handshakeHash()));
      } catch {
        this.handlers.onError(
          "pairing failed — wrong code or a machine in the middle",
        );
        this.cancel();
      }

      return;
    }
    try {
      const grant = JSON.parse(
        toUtf8(this.session.decrypt(bytes)),
      ) as PairingGrant;
      this.done = true;
      this.socket.close();
      this.handlers.onPaired({
        deviceId: grant.device_id,
        devPrivB64: toBase64(this.keypair.priv),
        devPubB64: toBase64(this.keypair.pub),
        hostPubB64: toBase64(fromBase64Url(this.payload.ds_pub)),
        url: this.url,
        capabilities: grant.capabilities,
      });
    } catch {
      this.handlers.onError("could not read pairing grant");
      this.cancel();
    }
  }
}
