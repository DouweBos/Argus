/**
 * Persistent storage for this device's identity + pairings, backed by
 * `expo-secure-store` (Keychain / Keystore, hardware-backed).
 *
 * A phone can be paired with several computers; one is active (connected) at a
 * time. Each pairing is its own identity — keypair, pinned desktop key, URL.
 */

import * as Device from "expo-device";
import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";
import { toBase64, fromBase64 } from "./base64";
import { readString, writeString } from "./storage";
import { generateKeypair, type NoiseKeypair } from "../crypto/noise";

/** Pre-multi-host single pairing; read once, then migrated away. */
const LEGACY_KEY = "argus.device";
const KEY = "argus.hosts";
const NAME_KEY = "device.name";

export interface DeviceIdentity {
  deviceId: string;
  /** This device's static X25519 keypair (base64). */
  devPrivB64: string;
  devPubB64: string;
  /** Pinned desktop static public key (base64). */
  desktopPubB64: string;
  /**
   * Public wss:// URL of the desktop gateway. Kept as the last known good
   * address and as the fallback for pairings made before endpoint sync.
   */
  url: string;
  /**
   * Every address this computer advertised, best first. Re-synced on each
   * connect, so a phone paired on Wi-Fi learns the tunnel addresses too.
   */
  endpoints?: RemoteEndpoint[];
  capabilities: string[];
  /** The computer's name, from the pairing grant or renamed on this phone. */
  hostName?: string;
  pairedAt?: number;
  /** @deprecated Superseded by the app-wide device name. */
  name?: string;
}

/** One route to a computer. Mirrors the desktop's `host.endpoints` payload. */
export interface RemoteEndpoint {
  kind: "cloudflare" | "lan" | "tailscale";
  url: string;
  /** Lower is simpler; probed in this order. */
  priority: number;
}

const KIND_PRIORITY: Record<RemoteEndpoint["kind"], number> = {
  lan: 0,
  tailscale: 1,
  cloudflare: 2,
};

/**
 * Classify a bare URL from a pre-endpoint-sync pairing, so a legacy identity
 * still sorts sensibly once real endpoints arrive alongside it.
 */
export function inferEndpointKind(url: string): RemoteEndpoint["kind"] {
  if (/\.ts\.net(?::\d+)?(?:\/|$)/i.test(url)) {
    return "tailscale";
  }
  if (/trycloudflare\.com|^wss:\/\//i.test(url)) {
    return "cloudflare";
  }

  return "lan";
}

/**
 * Addresses to try for a computer, best first. Falls back to the single paired
 * URL when the desktop has never synced its list.
 */
export function identityEndpoints(identity: DeviceIdentity): RemoteEndpoint[] {
  const known = identity.endpoints ?? [];
  const seen = new Set(known.map((e) => e.url));
  const all = [...known];
  // The paired URL stays a candidate — it's the only one a legacy identity has,
  // and it's still valid if the desktop is mid-restart and advertising nothing.
  if (identity.url && !seen.has(identity.url)) {
    const kind = inferEndpointKind(identity.url);
    all.push({ kind, url: identity.url, priority: KIND_PRIORITY[kind] });
  }

  return all.sort((a, b) => a.priority - b.priority);
}

export interface PairedHosts {
  hosts: DeviceIdentity[];
  /** Which pairing the app connects to; null once the last one is removed. */
  activeId: string | null;
}

const EMPTY: PairedHosts = { hosts: [], activeId: null };

/** Friendly default shown in the desktop's paired-device list. */
export function defaultDeviceName(): string {
  const model = Device.modelName?.trim();
  if (model) {
    return model;
  }

  return Platform.OS === "ios" ? "iPhone" : "Android device";
}

/** Label for a computer — its own name, else the gateway host. */
export function hostLabel(identity: DeviceIdentity): string {
  const named = identity.hostName?.trim();
  if (named) {
    return named;
  }

  return gatewayHost(identity.url);
}

export function gatewayHost(url: string): string {
  return url.replace(/^wss?:\/\//, "").replace(/\/+$/, "");
}

export async function loadHosts(): Promise<PairedHosts> {
  const raw = await SecureStore.getItemAsync(KEY);
  if (raw) {
    const parsed = JSON.parse(raw) as PairedHosts;

    return { hosts: parsed.hosts ?? [], activeId: parsed.activeId ?? null };
  }

  return migrateLegacy();
}

export async function saveHosts(state: PairedHosts): Promise<void> {
  await SecureStore.setItemAsync(KEY, JSON.stringify(state));
}

/** Add (or re-pair) a computer and make it the active one. */
export async function addHost(identity: DeviceIdentity): Promise<PairedHosts> {
  const current = await loadHosts();
  const next: PairedHosts = {
    // Re-pairing the same gateway replaces the stale grant rather than stacking.
    hosts: [
      ...current.hosts.filter(
        (h) => h.deviceId !== identity.deviceId && h.url !== identity.url,
      ),
      identity,
    ],
    activeId: identity.deviceId,
  };
  await saveHosts(next);

  return next;
}

export async function removeHost(deviceId: string): Promise<PairedHosts> {
  const current = await loadHosts();
  const hosts = current.hosts.filter((h) => h.deviceId !== deviceId);
  const next: PairedHosts = {
    hosts,
    activeId: current.activeId === deviceId ? null : current.activeId,
  };
  await saveHosts(next);

  return next;
}

export async function setActiveHost(
  deviceId: string | null,
): Promise<PairedHosts> {
  const current = await loadHosts();
  const next: PairedHosts = { ...current, activeId: deviceId };
  await saveHosts(next);

  return next;
}

export async function updateHost(
  deviceId: string,
  patch: Partial<DeviceIdentity>,
): Promise<PairedHosts> {
  const current = await loadHosts();
  const next: PairedHosts = {
    ...current,
    hosts: current.hosts.map((h) =>
      h.deviceId === deviceId ? { ...h, ...patch } : h,
    ),
  };
  await saveHosts(next);

  return next;
}

/** The phone's own display name, shared by every computer it's paired with. */
export async function loadDeviceName(): Promise<string> {
  return (await readString(NAME_KEY))?.trim() || defaultDeviceName();
}

export async function saveDeviceName(name: string): Promise<void> {
  await writeString(NAME_KEY, name);
}

async function migrateLegacy(): Promise<PairedHosts> {
  const raw = await SecureStore.getItemAsync(LEGACY_KEY);
  if (!raw) {
    return EMPTY;
  }
  const legacy = JSON.parse(raw) as DeviceIdentity;
  const state: PairedHosts = {
    hosts: [{ ...legacy, pairedAt: legacy.pairedAt ?? Date.now() }],
    activeId: legacy.deviceId,
  };
  await saveHosts(state);
  if (legacy.name?.trim() && !(await readString(NAME_KEY))) {
    await saveDeviceName(legacy.name.trim());
  }
  await SecureStore.deleteItemAsync(LEGACY_KEY).catch(() => {});

  return state;
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
