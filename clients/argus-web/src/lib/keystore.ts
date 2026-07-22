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

import { generateKeypair, type NoiseKeypair } from "../crypto/noise";
import { fromBase64, toBase64 } from "./base64";

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
