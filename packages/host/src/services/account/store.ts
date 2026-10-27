/**
 * What this host keeps about its account, inside the encrypted
 * `remote-devices.json` next to the Noise key: its Ed25519 signing key, the
 * Electron window's device keys, the pinned root and the verified log.
 */

import type {
  AccountConfig,
  AccountConfigPatch,
  AccountRoot,
  DeviceMember,
  HostMember,
  LogEntry,
} from "@argus/remote-protocol";
import { generateSigningKey } from "@argus/remote-protocol";
import { x25519 } from "@noble/curves/ed25519.js";
import { randomUUID } from "node:crypto";
import { hostname } from "node:os";
import {
  getAccountRecord,
  getDesktopIdentity,
  saveAccountRecord,
} from "../remote/deviceStore";

/** The Electron window as an account device: it dials other account hosts. */
export interface StoredDevice {
  id: string;
  sign_priv: string;
  sign_pub: string;
  noise_priv: string;
  noise_pub: string;
  created_at: number;
}

export interface AccountRecord {
  /** This host's member id, minted with its signing key. */
  host_id: string;
  host_sign_priv: string;
  host_sign_pub: string;
  host_created_at: number;
  device: StoredDevice | null;
  /** Null until linked. */
  root: AccountRoot | null;
  /** Every verified entry since genesis. */
  entries: LogEntry[];
  config: AccountConfig;
  /** Last time presence reached the service. */
  presence_at: number | null;
  /** Account devices revoked from this console: never re-materialized here. */
  blocked_devices?: string[];
}

export const DEFAULT_ACCOUNT_URL = "https://houwert.dev/argus/account/v1";

export const DEFAULT_ACCOUNT_CONFIG: AccountConfig = {
  enabled: true,
  service_url: "",
  grants: { ios: "control", desktop: "admin" },
  publish: { lan: true, tailscale: true, cloudflare: true },
  hosts_can_approve: true,
};

function freshIdentity(config: AccountConfig): AccountRecord {
  const key = generateSigningKey();

  return {
    host_id: randomUUID(),
    host_sign_priv: key.priv,
    host_sign_pub: key.pub,
    host_created_at: Date.now(),
    device: null,
    root: null,
    entries: [],
    config,
    presence_at: null,
  };
}

/** The record, minting a signing identity the first time one is needed. */
export async function ensureAccountRecord(): Promise<AccountRecord> {
  const existing = await getAccountRecord();
  if (existing) {
    return {
      ...existing,
      config: mergeConfig(DEFAULT_ACCOUNT_CONFIG, existing.config ?? {}),
    };
  }
  const created = freshIdentity(DEFAULT_ACCOUNT_CONFIG);
  await saveAccountRecord(created);

  return created;
}

export async function readAccountRecord(): Promise<AccountRecord | null> {
  return getAccountRecord();
}

export async function writeAccountRecord(record: AccountRecord): Promise<void> {
  await saveAccountRecord(record);
}

/**
 * Forget the account and the signing key that spoke for this host in it. The
 * settings stay: they are this machine's preferences, not the account's.
 */
export async function resetAccountRecord(
  previous: AccountRecord,
): Promise<AccountRecord> {
  const next = freshIdentity(previous.config);
  await saveAccountRecord(next);

  return next;
}

/** Mint the Electron window's device keys once. */
export function ensureDevice(record: AccountRecord): StoredDevice {
  if (record.device) {
    return record.device;
  }
  const sign = generateSigningKey();
  const noisePriv = x25519.utils.randomSecretKey();
  record.device = {
    id: randomUUID(),
    sign_priv: sign.priv,
    sign_pub: sign.pub,
    noise_priv: Buffer.from(noisePriv).toString("base64"),
    noise_pub: Buffer.from(x25519.getPublicKey(noisePriv)).toString("base64"),
    created_at: Date.now(),
  };

  return record.device;
}

/** "Douwe's Mac mini.local" → "Douwe's Mac mini", capped to a member name. */
export function machineName(): string {
  const name = [...hostname().replace(/\.local$/i, "")]
    .filter((ch) => ch >= " " && ch !== "\x7f")
    .join("")
    .trim();

  return (name || "Argus host").slice(0, 64);
}

export async function hostMember(record: AccountRecord): Promise<HostMember> {
  const identity = await getDesktopIdentity();

  return {
    id: record.host_id,
    role: "host",
    platform: process.platform === "linux" ? "linux" : "darwin",
    sign_pub: record.host_sign_pub,
    noise_pub: Buffer.from(identity.pub).toString("base64"),
    name: machineName(),
    created_at: record.host_created_at,
  };
}

export function deviceMember(device: StoredDevice): DeviceMember {
  return {
    id: device.id,
    role: "device",
    kind: "electron",
    sign_pub: device.sign_pub,
    noise_pub: device.noise_pub,
    name: `${machineName()} (desktop)`.slice(0, 64),
    created_at: device.created_at,
  };
}

export function mergeConfig(
  base: AccountConfig,
  patch: AccountConfigPatch,
): AccountConfig {
  return {
    enabled: patch.enabled ?? base.enabled,
    service_url: patch.service_url ?? base.service_url,
    grants: { ...base.grants, ...stripUndefined(patch.grants ?? {}) },
    publish: { ...base.publish, ...stripUndefined(patch.publish ?? {}) },
    hosts_can_approve: patch.hosts_can_approve ?? base.hosts_can_approve,
  };
}

function stripUndefined<T extends object>(value: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(value).filter(([, v]) => v !== undefined),
  ) as Partial<T>;
}

export function serviceUrl(record: AccountRecord): string {
  const override = process.env.ARGUS_ACCOUNT_URL || record.config.service_url;

  return (override || DEFAULT_ACCOUNT_URL).replace(/\/$/, "");
}
