/**
 * Device identity storage for the web client — `localStorage`.
 *
 * Unlike the native app there's no hardware-backed store in a browser, so the
 * static key sits in localStorage. This browser is its own paired, revocable
 * device; its scope is whatever the desktop granted (monitor, or monitor +
 * control), and it can be revoked or downgraded there at any time. Use the
 * native app, and think twice before granting control, where the key material
 * needs stronger protection.
 */

import {
  fromBase64,
  generateKeypair,
  toBase64,
  type HostCredentials,
  type NoiseKeypair,
  type PairingResult,
  type Transport,
} from "@argus/remote-client";
import { wsOrigin } from "./origin";

const KEY = "argus.device";

export interface DeviceIdentity {
  deviceId: string;
  devPrivB64: string;
  devPubB64: string;
  desktopPubB64: string;
  url: string;
  capabilities: string[];
  /** Client-chosen display name, shown in the desktop's paired-device list. */
  name: string;
  /** Set when this is an account computer opened from the hosted client. */
  account?: AccountHostLink;
}

/**
 * An account computer the hosted client dials: over its own `wss://` route,
 * with this browser's account key. Never written to `localStorage`.
 */
export interface AccountHostLink {
  hostId: string;
  hostName: string;
  credentials: HostCredentials;
  /** Runs once the channel is up (hands the host newer account entries). */
  onReady: (transport: Transport) => void;
  /** Back to the account's computer list. */
  leave: () => void;
}

/** Best-effort friendly default name from the browser's platform hints. */
export function defaultDeviceName(): string {
  const ua = navigator.userAgent;
  if (/iPhone/.test(ua)) {
    return "iPhone";
  }
  if (/iPad/.test(ua)) {
    return "iPad";
  }
  if (/Android/.test(ua)) {
    return "Android device";
  }
  if (/Macintosh|Mac OS X/.test(ua)) {
    return "Mac browser";
  }
  if (/Windows/.test(ua)) {
    return "Windows browser";
  }

  return "Web browser";
}

export function loadIdentity(): DeviceIdentity | null {
  const raw = localStorage.getItem(KEY);

  return raw ? (JSON.parse(raw) as DeviceIdentity) : null;
}

export function saveIdentity(identity: DeviceIdentity): void {
  localStorage.setItem(KEY, JSON.stringify(identity));
}

export function clearIdentity(): void {
  localStorage.removeItem(KEY);
}

export function freshKeypair(): {
  keypair: NoiseKeypair;
  privB64: string;
  pubB64: string;
} {
  const keypair = generateKeypair();

  return {
    keypair,
    privB64: toBase64(keypair.priv),
    pubB64: toBase64(keypair.pub),
  };
}

export function keypairFromIdentity(id: DeviceIdentity): NoiseKeypair {
  return { priv: fromBase64(id.devPrivB64), pub: fromBase64(id.devPubB64) };
}

/** Turn a completed pairing into the identity this browser persists. */
export function identityFromPairing(result: PairingResult): DeviceIdentity {
  return {
    deviceId: result.deviceId,
    devPrivB64: result.devPrivB64,
    devPubB64: result.devPubB64,
    desktopPubB64: result.hostPubB64,
    url: result.url,
    capabilities: result.capabilities,
    name: defaultDeviceName(),
  };
}

/**
 * Credentials for the shared transport. A paired host is always dialled on
 * our own origin; an account computer on the route it published.
 */
export function credentialsFor(id: DeviceIdentity): HostCredentials {
  if (id.account) {
    return id.account.credentials;
  }

  return {
    url: wsOrigin(),
    devPrivB64: id.devPrivB64,
    devPubB64: id.devPubB64,
    hostPubB64: id.desktopPubB64,
  };
}
