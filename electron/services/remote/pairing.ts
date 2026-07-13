/**
 * Device pairing (enrollment). Runs the Noise IKpsk1 responder handshake over
 * the local gateway's `/pair` socket so a new phone can enroll.
 *
 * The anti-MITM anchor is the 256-bit `pairing_secret`, which travels ONLY in
 * the QR / pairing code — never over the wire. It's mixed into the handshake as
 * a PSK, so anyone without the secret (including Cloudflare) cannot complete the
 * handshake in either direction. A 6-digit SAS is shown on both ends; the
 * desktop only hands over the grant (and persists the device) after the user
 * confirms.
 */

import { randomBytes, randomUUID } from "node:crypto";
import {
  PairingGrant,
  PairingPayload,
  type Capability,
} from "@argus/remote-protocol";
import { derivePairingPsk, deriveSas } from "./derive";
import {
  getDesktopIdentity,
  saveDevice,
  type PairedDevice,
} from "./deviceStore";
import { setPairingHandler } from "./localGatewayServer";
import { NoiseHandshake, type NoiseSession } from "./noise";

const PAIRING_TIMEOUT_MS = 2 * 60 * 1000;
const encoder = new TextEncoder();

export interface PairingStart {
  /** JSON payload to render as a QR code. */
  qrPayload: string;
  /** Same payload, base64url — a copy-paste fallback when a camera can't scan. */
  pairingCode: string;
}

export interface PairingCallbacks {
  onSas: (sas: string) => void;
  onPaired: (device: PairedDevice) => void;
  onError: (message: string) => void;
}

/** One in-flight pairing attempt. Single-use; times out after 2 minutes. */
class PairingSession {
  private session: NoiseSession | null = null;
  private pendingDevice: PairedDevice | null = null;
  private sendFn: ((out: Uint8Array) => void) | null = null;
  private timer: NodeJS.Timeout | null = null;
  private done = false;

  constructor(
    private readonly psk: Uint8Array,
    private readonly desktopStatic: { priv: Uint8Array; pub: Uint8Array },
    private readonly cb: PairingCallbacks,
  ) {}

  begin(): void {
    setPairingHandler({
      onData: (bytes, send) => this.onData(bytes, send),
      onClose: () => {},
    });
    this.timer = setTimeout(
      () => this.fail("pairing timed out"),
      PAIRING_TIMEOUT_MS,
    );
  }

  private onData(bytes: Uint8Array, send: (out: Uint8Array) => void): void {
    if (this.session || this.done) {
      return;
    }
    const handshake = new NoiseHandshake({
      role: "responder",
      staticKey: this.desktopStatic,
      psk: this.psk,
    });
    try {
      handshake.readMessage(bytes);
    } catch {
      // Wrong PSK (or a MITM) — cannot complete. Wait for a legitimate client.
      return;
    }
    const clientPub = Buffer.from(handshake.remoteStaticKey()).toString(
      "base64",
    );
    send(handshake.writeMessage(new Uint8Array(0)));
    this.session = handshake.session();
    this.sendFn = send;
    this.pendingDevice = {
      device_id: randomUUID(),
      label: "New device",
      dev_static_pub: clientPub,
      capabilities: ["monitor"] satisfies Capability[],
      created_at: Date.now(),
      last_seen: null,
    };
    this.cb.onSas(deriveSas(handshake.handshakeHash()));
  }

  async confirm(control = false): Promise<void> {
    if (this.done || !this.session || !this.pendingDevice || !this.sendFn) {
      throw new Error("no pairing awaiting confirmation");
    }
    // Grant "control" only when the user opted in on the confirm screen.
    this.pendingDevice.capabilities = [
      "monitor",
      ...(control ? (["control"] as const) : []),
    ];
    const grant: PairingGrant = {
      device_id: this.pendingDevice.device_id,
      capabilities: this.pendingDevice.capabilities,
    };
    this.sendFn(
      this.session.encrypt(
        encoder.encode(JSON.stringify(PairingGrant.parse(grant))),
      ),
    );
    await saveDevice(this.pendingDevice);
    const device = this.pendingDevice;
    this.finish();
    this.cb.onPaired(device);
  }

  cancel(): void {
    this.finish();
  }

  private fail(message: string): void {
    if (this.done) {
      return;
    }
    this.finish();
    this.cb.onError(message);
  }

  private finish(): void {
    this.done = true;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    setPairingHandler(null);
  }
}

let active: PairingSession | null = null;

/**
 * Start a pairing attempt. Generates the out-of-band secret and returns the QR
 * / code payload. Requires remote access to be up with a known public URL.
 */
export async function startPairing(
  publicUrl: string | null,
  cb: PairingCallbacks,
): Promise<PairingStart> {
  active?.cancel();
  if (!publicUrl) {
    throw new Error("tunnel is not ready yet — no public URL");
  }

  const identity = await getDesktopIdentity();
  const pairingSecret = randomBytes(32);
  const psk = derivePairingPsk(new Uint8Array(pairingSecret));

  const payload: PairingPayload = {
    v: 1,
    url: publicUrl,
    ds_pub: Buffer.from(identity.pub).toString("base64url"),
    pairing_secret: pairingSecret.toString("base64url"),
  };
  const qrPayload = JSON.stringify(PairingPayload.parse(payload));

  const session = new PairingSession(
    psk,
    { priv: identity.priv, pub: identity.pub },
    {
      onSas: cb.onSas,
      onError: (m) => {
        active = null;
        cb.onError(m);
      },
      onPaired: (d) => {
        active = null;
        cb.onPaired(d);
      },
    },
  );
  session.begin();
  active = session;

  return {
    qrPayload,
    pairingCode: Buffer.from(qrPayload).toString("base64url"),
  };
}

export async function confirmPairing(control = false): Promise<void> {
  if (!active) {
    throw new Error("no pairing in progress");
  }
  await active.confirm(control);
}

export function cancelPairing(): void {
  active?.cancel();
  active = null;
}
