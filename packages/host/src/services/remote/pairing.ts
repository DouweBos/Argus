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

import {
  PairingClientInfo,
  PairingGrant,
  PairingPayload,
  type Capability,
} from "@argus/remote-protocol";
import { execFile } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { hostname } from "node:os";
import { promisify } from "node:util";
import { derivePairingPsk, deriveSas } from "./derive";
import {
  capabilitiesFor,
  getDesktopIdentity,
  saveDevice,
  type DeviceGrants,
  type PairedDevice,
} from "./deviceStore";
import { setPairingHandler } from "./localGatewayServer";
import { NoiseHandshake, type NoiseSession } from "./noise";

const PAIRING_TIMEOUT_MS = 2 * 60 * 1000;
const encoder = new TextEncoder();
const execFileAsync = promisify(execFile);

/** Friendly computer name for the phone's list ("Douwe's MacBook Pro"). */
async function computerName(): Promise<string> {
  if (process.platform === "darwin") {
    try {
      const { stdout } = await execFileAsync("scutil", [
        "--get",
        "ComputerName",
      ]);
      const name = stdout.trim();
      if (name) {
        return name;
      }
    } catch {
      // Fall through to the network hostname.
    }
  }

  return hostname().replace(/\.local$/, "");
}

/**
 * What the client said it is, or null when it said nothing the schema accepts.
 *
 * Never trusted for a decision the host enforces — it is unauthenticated until
 * the human confirms the SAS. It names the thing on the confirm screen, and
 * decides which grants are worth offering for it.
 */
function parseClientInfo(payload: Uint8Array): PairingClientInfo | null {
  if (payload.length === 0) {
    return null;
  }
  try {
    const parsed = PairingClientInfo.safeParse(
      JSON.parse(Buffer.from(payload).toString("utf8")),
    );

    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

/** "Argus Remote on iPhone", or just the product when it did not say. */
export function clientLabel(client: PairingClientInfo): string {
  return client.device
    ? `${client.product} on ${client.device}`
    : client.product;
}

export interface PairingStart {
  /** JSON payload to render as a QR code. */
  qrPayload: string;
  /** Same payload, base64url — a copy-paste fallback when a camera can't scan. */
  pairingCode: string;
}

export interface PairingCallbacks {
  onSas: (sas: string, client: PairingClientInfo | null) => void;
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

  /** False when the frame is refused, so the gateway drops that socket. */
  private onData(bytes: Uint8Array, send: (out: Uint8Array) => void): boolean {
    if (this.session || this.done) {
      return false;
    }
    const handshake = new NoiseHandshake({
      role: "responder",
      staticKey: this.desktopStatic,
      psk: this.psk,
    });
    let identity: Uint8Array;
    try {
      identity = handshake.readMessage(bytes);
    } catch {
      // Wrong PSK (or a MITM) — cannot complete. Wait for a legitimate client.
      return false;
    }
    const client = parseClientInfo(identity);
    const clientPub = Buffer.from(handshake.remoteStaticKey()).toString(
      "base64",
    );
    send(handshake.writeMessage(new Uint8Array(0)));
    this.session = handshake.session();
    this.sendFn = send;
    this.pendingDevice = {
      device_id: randomUUID(),
      // Named by what it said it is, until it renames itself on first connect.
      label: client ? clientLabel(client) : "New device",
      dev_static_pub: clientPub,
      capabilities: ["monitor"] satisfies Capability[],
      created_at: Date.now(),
      last_seen: null,
    };
    this.cb.onSas(deriveSas(handshake.handshakeHash()), client);

    return true;
  }

  async confirm(grants: DeviceGrants = {}): Promise<void> {
    if (this.done || !this.session || !this.pendingDevice || !this.sendFn) {
      throw new Error("no pairing awaiting confirmation");
    }
    // Grant "control"/"admin" only when the user opted in on the confirm screen.
    this.pendingDevice.capabilities = capabilitiesFor(grants);
    const grant: PairingGrant = {
      device_id: this.pendingDevice.device_id,
      capabilities: this.pendingDevice.capabilities,
      host_name: await computerName(),
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

/** `grants` accepts the legacy boolean for the control-only confirm screen. */
export async function confirmPairing(
  grants: DeviceGrants | boolean = false,
): Promise<void> {
  if (!active) {
    throw new Error("no pairing in progress");
  }
  await active.confirm(
    typeof grants === "boolean" ? { control: grants } : grants,
  );
}

export function cancelPairing(): void {
  active?.cancel();
  active = null;
}
