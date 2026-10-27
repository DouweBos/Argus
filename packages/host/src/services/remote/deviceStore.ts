/**
 * Persisted remote-access identity and paired-device records.
 *
 * The desktop static private key + paired-device records are encrypted with
 * the host's secret storage and stored base64 in `~/.argus/remote-devices.json`
 * (mode 0600), like the MCP OAuth store. Public keys are not secret but live in
 * the same encrypted blob for simplicity.
 *
 * If secret storage is unavailable we fall back to plaintext
 * with a warning, matching the OAuth store — remote access still works, just
 * without at-rest encryption on that host.
 */

import type { AccountRecord } from "../account/store";
import type { Capability } from "@argus/remote-protocol";
import { promises as fs } from "node:fs";
import path from "node:path";
import { warn } from "@argus/host/logger";
import { isNodeSecretBlob } from "../../lib/nodeSecretStorage";
import { argusDirPath } from "../onboarding/state";
import {
  legacySecretStoreMessage,
  secretStorageFor,
  usesLegacySecretStorage,
} from "../secrets/legacyStores";
import { generateKeypair } from "./noise";

/** A device's push registration, handed over the gateway after pairing. */
export interface DevicePushToken {
  service: "apns" | "fcm" | "webpush";
  /** Native device token, or the Web Push endpoint URL for "webpush". */
  token: string;
  /** APNs only — which Apple environment minted the token. */
  environment?: "production" | "sandbox";
  /** Web Push only — the subscription's encryption keys (base64url). */
  keys?: { auth: string; p256dh: string };
  /**
   * APNs/FCM via the relay: the 32-byte AES key this device minted, base64.
   * Notifications are sealed with it so the relay only ever sees ciphertext.
   */
  push_key?: string;
  /** The 32-byte HMAC key the device registered with the relay, base64. */
  auth_key?: string;
  updated_at: number;
}

export interface PairedDevice {
  device_id: string;
  label: string;
  /** Pinned client static X25519 public key, base64. Handshake identity. */
  dev_static_pub: string;
  capabilities: Capability[];
  created_at: number;
  last_seen: number | null;
  /** Present once the phone has registered for background push. */
  push?: DevicePushToken | null;
  /**
   * How the device got in: a QR pairing (absent on records from before
   * accounts), or materialized from the account log on first handshake.
   */
  source?: "account" | "pairing";
}

/**
 * Push settings. The VAPID key is a real secret, so this lives in the same
 * encrypted blob as the device keys rather than in plaintext
 * `app-settings.json`. APNs/FCM credentials are deliberately absent — those
 * belong to the phone app's Apple team and live in the relay.
 */
export interface PushConfig {
  enabled: boolean;
  /** VAPID signing key for browsers (PEM), generated on first use. */
  vapid_private_pem: string;
  /** The matching raw P-256 public key, base64url — browsers subscribe with it. */
  vapid_public: string;
  /** VAPID `sub` claim: a mailto:/https: contact for the push service. */
  vapid_subject: string;
  /** Override the push relay. Empty means the bundled default. */
  relay_url: string;
}

export const EMPTY_PUSH_CONFIG: PushConfig = {
  enabled: false,
  vapid_private_pem: "",
  vapid_public: "",
  vapid_subject: "mailto:argus@localhost",
  relay_url: "",
};

/** The desktop's long-lived identity + all paired devices. */
interface RemoteState {
  /** Desktop static X25519 private key, base64. */
  ds_priv: string;
  /** Desktop static X25519 public key, base64. */
  ds_pub: string;
  devices: Record<string, PairedDevice>;
  push_config?: PushConfig;
  /** The account link: signing keys, pinned root, verified log. */
  account?: AccountRecord | null;
}

interface FileShape {
  data: RemoteState | string;
  enc: boolean;
}

function storePath(): string {
  return path.join(argusDirPath(), "remote-devices.json");
}

function freshState(): RemoteState {
  const kp = generateKeypair();

  return {
    ds_priv: Buffer.from(kp.priv).toString("base64"),
    ds_pub: Buffer.from(kp.pub).toString("base64"),
    devices: {},
  };
}

/**
 * The stored state, or null when there is none yet. A store that exists but
 * can't be read throws: regenerating over it would silently replace the host's
 * identity and drop every pairing.
 */
async function readState(): Promise<RemoteState | null> {
  let raw: string;
  try {
    raw = await fs.readFile(storePath(), "utf-8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      return null;
    }
    throw new Error(
      `failed to read the remote device store: ${(err as Error).message}`,
    );
  }

  const file = JSON.parse(raw) as FileShape;
  if (file.enc) {
    const blob = Buffer.from(file.data as string, "base64");
    if (!isNodeSecretBlob(blob) && !usesLegacySecretStorage("remote_devices")) {
      throw new Error(
        legacySecretStoreMessage("Your paired devices and remote access key"),
      );
    }
    if (!secretStorageFor("remote_devices").isAvailable()) {
      throw new Error(
        "the remote device store is encrypted but this host has no secret storage to decrypt it",
      );
    }
    try {
      const json = secretStorageFor("remote_devices").decrypt(blob);

      return JSON.parse(json) as RemoteState;
    } catch (err) {
      throw new Error(
        `failed to decrypt the remote device store: ${(err as Error).message}`,
      );
    }
  }

  return file.data as RemoteState;
}

async function writeState(state: RemoteState): Promise<void> {
  await fs.mkdir(argusDirPath(), { recursive: true });
  let file: FileShape;
  if (secretStorageFor("remote_devices").isAvailable()) {
    const buf = secretStorageFor("remote_devices").encrypt(
      JSON.stringify(state),
    );
    file = { enc: true, data: buf.toString("base64") };
  } else {
    warn(
      "[remote] secret storage unavailable — writing remote device store in plaintext",
    );
    file = { enc: false, data: state };
  }
  await fs.writeFile(storePath(), JSON.stringify(file, null, 2), {
    mode: 0o600,
  });
}

/** Listeners notified when the persisted device set changes (add/rename/revoke). */
const changeListeners = new Set<() => void>();

/** Subscribe to device-set changes; returns an unsubscribe. */
export function onDevicesChanged(cb: () => void): () => void {
  changeListeners.add(cb);

  return () => changeListeners.delete(cb);
}

function emitDevicesChanged(): void {
  for (const cb of changeListeners) {
    cb();
  }
}

let cached: RemoteState | null = null;

/** Load-or-create the desktop identity, generating keys on first launch. */
async function ensureState(): Promise<RemoteState> {
  if (cached) {
    return cached;
  }
  const existing = await readState();
  if (existing) {
    cached = existing;

    return existing;
  }
  const created = freshState();
  await writeState(created);
  cached = created;

  return created;
}

export interface DesktopIdentity {
  priv: Uint8Array;
  pub: Uint8Array;
}

export async function getDesktopIdentity(): Promise<DesktopIdentity> {
  const state = await ensureState();

  return {
    priv: Buffer.from(state.ds_priv, "base64"),
    pub: Buffer.from(state.ds_pub, "base64"),
  };
}

/**
 * The desktop's public key, base64url as the pairing payload's `ds_pub` — what
 * a Handoff activity names this computer by.
 */
export async function getHostKey(): Promise<string> {
  const { pub } = await getDesktopIdentity();

  return Buffer.from(pub).toString("base64url");
}

export async function listDevices(): Promise<PairedDevice[]> {
  const state = await ensureState();

  return Object.values(state.devices);
}

export async function getDevice(
  deviceId: string,
): Promise<PairedDevice | null> {
  const state = await ensureState();

  return state.devices[deviceId] ?? null;
}

/** Look up a device by its pinned static public key (base64). */
export async function findDeviceByStaticKey(
  devStaticPubB64: string,
): Promise<PairedDevice | null> {
  const state = await ensureState();

  return (
    Object.values(state.devices).find(
      (d) => d.dev_static_pub === devStaticPubB64,
    ) ?? null
  );
}

export async function saveDevice(device: PairedDevice): Promise<void> {
  const state = await ensureState();
  state.devices[device.device_id] = device;
  await writeState(state);
  emitDevicesChanged();
}

/** Rename a device (its client-chosen display label). */
export async function renameDevice(
  deviceId: string,
  label: string,
): Promise<void> {
  const state = await ensureState();
  const device = state.devices[deviceId];
  if (!device || device.label === label) {
    return;
  }
  device.label = label;
  await writeState(state);
  emitDevicesChanged();
}

/** Replace a device's capability grants (e.g. toggle "control" on/off). */
export async function setDeviceCapabilities(
  deviceId: string,
  capabilities: Capability[],
): Promise<void> {
  const state = await ensureState();
  const device = state.devices[deviceId];
  if (!device) {
    return;
  }
  device.capabilities = capabilities;
  await writeState(state);
  emitDevicesChanged();
}

/** The grants a user ticks on the confirm screen / the device row. */
export interface DeviceGrants {
  control?: boolean;
  /** Raw IPC passthrough — another Mac of yours, never a browser. */
  admin?: boolean;
}

/** Expand the ticked grants into the stored capability list. */
export function capabilitiesFor(grants: DeviceGrants): Capability[] {
  return [
    "monitor",
    ...(grants.control || grants.admin ? (["control"] as const) : []),
    ...(grants.admin ? (["admin"] as const) : []),
  ];
}

/** Set a device's grants from the ticked toggles (the `control`/`admin` pair). */
export async function setDeviceGrants(
  deviceId: string,
  grants: DeviceGrants,
): Promise<void> {
  await setDeviceCapabilities(deviceId, capabilitiesFor(grants));
}

export async function updateLastSeen(
  deviceId: string,
  when: number,
): Promise<void> {
  const state = await ensureState();
  const device = state.devices[deviceId];
  if (!device) {
    return;
  }
  device.last_seen = when;
  await writeState(state);
}

/** Store (or replace) a device's native push token. */
export async function setDevicePush(
  deviceId: string,
  push: DevicePushToken,
): Promise<void> {
  const state = await ensureState();
  const device = state.devices[deviceId];
  if (!device) {
    return;
  }
  const prev = device.push;
  if (
    prev &&
    prev.service === push.service &&
    prev.token === push.token &&
    prev.environment === push.environment &&
    prev.keys?.p256dh === push.keys?.p256dh &&
    prev.keys?.auth === push.keys?.auth &&
    prev.push_key === push.push_key &&
    prev.auth_key === push.auth_key
  ) {
    return;
  }
  device.push = push;
  await writeState(state);
}

/** Correct a device's recorded APNs environment after a sandbox/prod mismatch. */
export async function setDevicePushEnvironment(
  deviceId: string,
  environment: "production" | "sandbox",
): Promise<void> {
  const state = await ensureState();
  const push = state.devices[deviceId]?.push;
  if (!push || push.environment === environment) {
    return;
  }
  push.environment = environment;
  await writeState(state);
}

/**
 * Forget a device's push token. Called when the user disables notifications on
 * the phone and when a provider tells us the token is dead (APNs 410 /
 * FCM UNREGISTERED), so we stop pushing into a black hole.
 */
export async function clearDevicePush(deviceId: string): Promise<void> {
  const state = await ensureState();
  const device = state.devices[deviceId];
  if (!device?.push) {
    return;
  }
  device.push = null;
  await writeState(state);
}

export async function getPushConfig(): Promise<PushConfig> {
  const state = await ensureState();

  return { ...EMPTY_PUSH_CONFIG, ...(state.push_config ?? {}) };
}

export async function savePushConfig(
  patch: Partial<PushConfig>,
): Promise<PushConfig> {
  const state = await ensureState();
  const next: PushConfig = {
    ...EMPTY_PUSH_CONFIG,
    ...(state.push_config ?? {}),
    ...patch,
  };
  state.push_config = next;
  await writeState(state);

  return next;
}

/** Revoke a device — its pinned key is gone, so future handshakes fail. */
export async function revokeDevice(deviceId: string): Promise<void> {
  const state = await ensureState();
  if (state.devices[deviceId]) {
    state.devices = Object.fromEntries(
      Object.entries(state.devices).filter(([id]) => id !== deviceId),
    );
    await writeState(state);
    emitDevicesChanged();
  }
}

export async function getAccountRecord(): Promise<AccountRecord | null> {
  const state = await ensureState();

  return state.account ?? null;
}

export async function saveAccountRecord(
  record: AccountRecord | null,
): Promise<void> {
  const state = await ensureState();
  state.account = record;
  await writeState(state);
}

/**
 * Rotate the desktop static identity. QR-paired devices can no longer
 * authenticate the desktop (their pinned `ds_pub` is stale) and must re-pair,
 * so we clear them. Account devices survive: they re-read the key from the
 * log's `rotate` entry.
 */
export async function rotateDesktopIdentity(): Promise<DesktopIdentity> {
  const previous = await ensureState();
  const created = freshState();
  created.account = previous.account ?? null;
  created.devices = Object.fromEntries(
    Object.entries(previous.devices).filter(([, d]) => d.source === "account"),
  );
  await writeState(created);
  cached = created;
  emitDevicesChanged();

  return {
    priv: Buffer.from(created.ds_priv, "base64"),
    pub: Buffer.from(created.ds_pub, "base64"),
  };
}
