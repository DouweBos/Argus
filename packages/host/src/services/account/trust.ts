/**
 * The verified account state this host acts on, and the bridge from it to the
 * gateway's trust store: an account device is materialized as a
 * `PairedDevice { source: "account" }` on its first handshake, so grants,
 * last-seen and push work unchanged, and dropped again when the log revokes it.
 */

import type { AccountRecord } from "./store";
import type {
  AccountGrantSetting,
  DeviceMember,
  LogState,
} from "@argus/remote-protocol";
import { verifyLog } from "@argus/remote-protocol";
import { warn } from "@argus/host/logger";
import {
  capabilitiesFor,
  listDevices,
  revokeDevice,
  saveDevice,
  type PairedDevice,
} from "../remote/deviceStore";
import { capture } from "../telemetry/telemetry";
import { readAccountRecord } from "./store";

let record: AccountRecord | null = null;
let state: LogState | null = null;
let logError: string | null = null;
/** Set by boot: closes a device's live gateway connection (avoids an import cycle). */
let disconnect: (deviceId: string) => void = () => undefined;

export function setDeviceDisconnector(fn: (deviceId: string) => void): void {
  disconnect = fn;
}

/** Load the stored record and re-verify its log from the pinned root. */
export async function loadTrust(): Promise<void> {
  record = await readAccountRecord();
  state = null;
  logError = null;
  if (!record?.root || record.entries.length === 0) {
    return;
  }
  const result = verifyLog(record.entries, { root: record.root });
  if (result.ok) {
    state = result.state;
  } else {
    // Our own stored log no longer verifies: stay on the last good prefix.
    logError = result.reason;
    state = result.state;
    warn(`[account] stored log rejected: ${result.reason}`);
  }
}

export function currentRecord(): AccountRecord | null {
  return record;
}

export function currentState(): LogState | null {
  return state;
}

export function currentLogError(): string | null {
  return logError;
}

export function setTrust(
  next: AccountRecord | null,
  nextState: LogState | null,
  error: string | null = null,
): void {
  record = next;
  state = nextState;
  logError = error;
}

export function isLinked(): boolean {
  return !!record?.root && !!state && !!state.members[record.host_id]?.live;
}

function liveDevice(id: string): DeviceMember | null {
  const found = state?.members[id];
  if (!found?.live || found.member.role !== "device") {
    return null;
  }

  return found.member;
}

function grantsFor(member: DeviceMember): AccountGrantSetting {
  const grants = record?.config.grants;
  if (!grants) {
    return "monitor";
  }

  return member.kind === "ios" ? grants.ios : grants.desktop;
}

/** Whether a materialized account device may still connect. */
export function accountAllowsDevice(device: PairedDevice): boolean {
  if (device.source !== "account") {
    return true;
  }
  if (!isLinked() || !record?.config.enabled) {
    return false;
  }
  const member = liveDevice(device.device_id);

  return !!member && member.noise_pub === device.dev_static_pub;
}

/**
 * The account device behind `noisePubB64`, materialized on first sight. Null
 * when this host is not linked, accounts are switched off, or no live device
 * in the verified log has that key.
 */
export async function findAccountDevice(
  noisePubB64: string,
): Promise<PairedDevice | null> {
  if (!isLinked() || !record?.config.enabled || !state) {
    return null;
  }
  const member = Object.values(state.members).find(
    (m) =>
      m.live &&
      m.member.role === "device" &&
      m.member.noise_pub === noisePubB64 &&
      m.member.id !== record?.device?.id,
  )?.member;
  if (!member || member.role !== "device") {
    return null;
  }
  const grant = grantsFor(member);
  const device: PairedDevice = {
    device_id: member.id,
    label: member.name,
    dev_static_pub: member.noise_pub,
    capabilities: capabilitiesFor({
      control: grant !== "monitor",
      admin: grant === "admin",
    }),
    created_at: Date.now(),
    last_seen: null,
    source: "account",
  };
  await saveDevice(device);

  return device;
}

/**
 * Bring materialized devices in line with the log: revoked or unlinked ones
 * go (and are disconnected), rotated ones follow their new key.
 */
export async function reconcileDevices(): Promise<void> {
  const devices = await listDevices();
  for (const device of devices) {
    if (device.source !== "account") {
      continue;
    }
    const member = isLinked() ? liveDevice(device.device_id) : null;
    if (!member) {
      await revokeDevice(device.device_id);
      disconnect(device.device_id);
      capture("account_member_revoked", { role: "device", source: "log" });
      continue;
    }
    if (member.noise_pub !== device.dev_static_pub) {
      await saveDevice({ ...device, dev_static_pub: member.noise_pub });
      disconnect(device.device_id);
    }
  }
}

/** Drop every materialized account device (on unlink). */
export async function dropAccountDevices(): Promise<void> {
  for (const device of await listDevices()) {
    if (device.source === "account") {
      await revokeDevice(device.device_id);
      disconnect(device.device_id);
    }
  }
}
