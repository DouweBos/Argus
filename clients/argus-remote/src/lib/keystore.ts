/**
 * Persistent storage for this device's identity + pairing, backed by
 * `expo-secure-store` (Keychain / Keystore, hardware-backed).
 */

import * as SecureStore from "expo-secure-store";
import { toBase64, fromBase64 } from "./base64";
import { generateKeypair, type NoiseKeypair } from "../crypto/noise";

const KEY = "argus.device";

export interface DeviceIdentity {
  deviceId: string;
  /** This device's static X25519 keypair (base64). */
  devPrivB64: string;
  devPubB64: string;
  /** Pinned desktop static public key (base64). */
  desktopPubB64: string;
  /** Public wss:// URL of the desktop gateway (via the tunnel). */
  url: string;
  capabilities: string[];
}

export async function loadIdentity(): Promise<DeviceIdentity | null> {
  const raw = await SecureStore.getItemAsync(KEY);

  return raw ? (JSON.parse(raw) as DeviceIdentity) : null;
}

export async function saveIdentity(identity: DeviceIdentity): Promise<void> {
  await SecureStore.setItemAsync(KEY, JSON.stringify(identity));
}

export async function clearIdentity(): Promise<void> {
  await SecureStore.deleteItemAsync(KEY);
}

/** Generate a fresh static keypair for enrollment. */
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
