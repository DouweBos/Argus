/**
 * Client half of pairing: connects to the desktop gateway's `/pair` endpoint,
 * runs the Noise IKpsk1 initiator handshake, shows the SAS, and receives the
 * encrypted grant the desktop sends after the user confirms. Produces a
 * `DeviceIdentity` to persist.
 */

import { NoiseHandshake, type NoiseSession } from "../crypto/noise";
import { derivePairingPsk, deriveSas } from "../crypto/derive";
import { fromBase64Url, fromUtf8, toBase64, toUtf8 } from "./base64";
import {
  defaultDeviceName,
  freshKeypair,
  type DeviceIdentity,
} from "./keystore";
import type { PairingGrant, PairingPayload } from "./protocol";
import { GatewaySocket } from "./socket";

export interface PairingHandlers {
  onSas: (sas: string) => void;
  onPaired: (identity: DeviceIdentity) => void;
  onError: (message: string) => void;
}

/** Parse a scanned QR string or pasted base64url pairing code into a payload. */
export function parsePairingInput(input: string): PairingPayload {
  const trimmed = input.trim();
  const json = trimmed.startsWith("{") ? trimmed : toUtf8(fromBase64Url(trimmed));
  const payload = JSON.parse(json) as PairingPayload;
  if (payload.v !== 1 || !payload.url || !payload.ds_pub) {
    throw new Error("invalid pairing code");
  }

  return payload;
}

/**
 * What we tell the computer we are, so its confirm screen can name us and drop
 * the grants a phone has no use for. Sent in the first handshake message.
 */
function identity(): Uint8Array {
  return fromUtf8(
    JSON.stringify({
      product: "Argus Remote",
      kind: "mobile",
      device: defaultDeviceName(),
    }),
  );
}

export class PairingClient {
  private socket: GatewaySocket;
  private hs: NoiseHandshake | null = null;
  private session: NoiseSession | null = null;
  private readonly keypair = freshKeypair();
  private done = false;

  constructor(
    private readonly payload: PairingPayload,
    private readonly handlers: PairingHandlers,
  ) {
    this.socket = new GatewaySocket(`${payload.url}/pair`, {
      onOpen: () => {
        this.hs = new NoiseHandshake({
          role: "initiator",
          staticKey: this.keypair.keypair,
          remoteStatic: fromBase64Url(this.payload.ds_pub),
          psk: derivePairingPsk(fromBase64Url(this.payload.pairing_secret)),
        });
        this.socket.send(this.hs.writeMessage(identity()));
      },
      onFrame: (bytes) => this.onData(bytes),
      onClose: () => {},
    });
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
        devPrivB64: this.keypair.privB64,
        devPubB64: this.keypair.pubB64,
        desktopPubB64: toBase64(fromBase64Url(this.payload.ds_pub)),
        url: this.payload.url,
        capabilities: grant.capabilities,
        hostName: grant.host_name,
        pairedAt: Date.now(),
      });
    } catch {
      this.handlers.onError("could not read pairing grant");
      this.cancel();
    }
  }
}
