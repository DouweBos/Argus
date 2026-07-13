/**
 * Persisted remote-access identity and paired-device records.
 *
 * The desktop static private key + paired-device records are encrypted with
 * Electron's `safeStorage` and stored
 * base64 in `~/.argus/remote-devices.json` (mode 0600). Mirrors the approach in
 * `electron/services/mcp/oauthStore.ts`. Public keys are not secret but live in
 * the same encrypted blob for simplicity.
 *
 * If `safeStorage.isEncryptionAvailable()` is false we fall back to plaintext
 * with a warning, matching the OAuth store — remote access still works, just
 * without at-rest encryption on that host.
 */

import type { Capability } from "@argus/remote-protocol";
import { safeStorage } from "electron";
import { promises as fs } from "node:fs";
import path from "node:path";
import { warn } from "../../../app/lib/logger";
import { argusDirPath } from "../onboarding/state";
import { generateKeypair } from "./noise";

export interface PairedDevice {
  device_id: string;
  label: string;
  /** Pinned client static X25519 public key, base64. Handshake identity. */
  dev_static_pub: string;
  capabilities: Capability[];
  created_at: number;
  last_seen: number | null;
}

/** The desktop's long-lived identity + all paired devices. */
interface RemoteState {
  /** Desktop static X25519 private key, base64. */
  ds_priv: string;
  /** Desktop static X25519 public key, base64. */
  ds_pub: string;
  devices: Record<string, PairedDevice>;
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

async function readState(): Promise<RemoteState | null> {
  let raw: string;
  try {
    raw = await fs.readFile(storePath(), "utf-8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      return null;
    }
    warn(`[remote] failed to read device store: ${(err as Error).message}`);

    return null;
  }

  const file = JSON.parse(raw) as FileShape;
  if (file.enc) {
    if (!safeStorage.isEncryptionAvailable()) {
      warn(
        "[remote] encryption unavailable but store is encrypted; cannot read",
      );

      return null;
    }
    try {
      const json = safeStorage
        .decryptString(Buffer.from(file.data as string, "base64"))
        .toString();

      return JSON.parse(json) as RemoteState;
    } catch (err) {
      warn(
        `[remote] failed to decrypt device store: ${(err as Error).message}`,
      );

      return null;
    }
  }

  return file.data as RemoteState;
}

async function writeState(state: RemoteState): Promise<void> {
  await fs.mkdir(argusDirPath(), { recursive: true });
  let file: FileShape;
  if (safeStorage.isEncryptionAvailable()) {
    const buf = safeStorage.encryptString(JSON.stringify(state));
    file = { enc: true, data: buf.toString("base64") };
  } else {
    warn(
      "[remote] safeStorage unavailable — writing remote device store in plaintext",
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

/**
 * Rotate the desktop static identity. All existing devices can no longer
 * authenticate the desktop (their pinned `ds_pub` is stale) and must re-pair,
 * so we clear them.
 */
export async function rotateDesktopIdentity(): Promise<void> {
  const created = freshState();
  await writeState(created);
  cached = created;
}
