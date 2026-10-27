/**
 * Saved EAS Simulator hosts and their runtimes: add, update, remove, check the
 * account, and the sweeps at boot and shutdown that keep billed sessions from
 * outliving the host process that started them.
 */

import type {
  EasAccount,
  EasDeviceHost,
  EasDeviceHostInput,
} from "@argus/remote-protocol";
import { createLogger } from "@argus/host/logger";
import { registerDeviceSourceProvider } from "../../simulator/deviceSources";
import { capture } from "../../telemetry/telemetry";
import {
  type EasHostConfig,
  loadEasHosts,
  newEasHostId,
  normalizeEasHostInput,
  saveEasHosts,
} from "./config";
import { EasError, resolveExpoCredential } from "./credential";
import { makeExpoApi } from "./expoApi";
import { EasHost } from "./host";
import { EAS_ID_PREFIX, easDeviceId, parseEasDeviceId } from "./ids";
import { deleteLedger, ledgerHostIds } from "./ledger";
import { easDeviceProvider, easMessage } from "./source";
import { hasEasToken, readEasToken, writeEasToken } from "./tokens";

const log = createLogger("eas");

/** How long shutdown waits on Expo before leaving the rest to the next process. */
const SHUTDOWN_WAIT_MS = 8_000;

let hosts: Map<string, EasHost> | null = null;
const removedListeners = new Set<(hostId: string) => void>();
let unregister: (() => void) | null = null;

function runtimeFor(config: EasHostConfig): EasHost {
  const host = new EasHost(config, {
    savedToken: () => readEasToken(config.id),
  });
  host.adoptRecorded();

  return host;
}

function all(): Map<string, EasHost> {
  hosts ??= new Map(loadEasHosts().map((c) => [c.id, runtimeFor(c)]));

  return hosts;
}

function save(): void {
  saveEasHosts([...all().values()].map((h) => h.config));
}

function toWire(host: EasHost): EasDeviceHost {
  return {
    ...host.config,
    hasToken: hasEasToken(host.id),
    runningSessions: host.runningSessions(),
    error: host.error,
  };
}

export function easHost(hostId: string): EasHost | undefined {
  return all().get(hostId);
}

export function listEasDeviceHosts(): EasDeviceHost[] {
  return [...all().values()].map(toWire);
}

export function addEasDeviceHost(input: EasDeviceHostInput): EasDeviceHost {
  const config: EasHostConfig = {
    id: newEasHostId(),
    ...normalizeEasHostInput(input),
  };
  if (input.token) {
    writeEasToken(config.id, input.token);
  }
  const host = runtimeFor(config);
  all().set(config.id, host);
  save();
  capture("eas_device_host_added", {
    has_token: Boolean(input.token?.trim()),
    has_app_id: config.appId !== null,
  });

  return toWire(host);
}

/** New limits apply to sessions started from now on. */
export function updateEasDeviceHost(
  input: EasDeviceHostInput & { id: string },
): EasDeviceHost {
  const host = all().get(input.id);
  if (!host) {
    throw "No such EAS Simulator host.";
  }
  const { id: _id, ...rest } = host.config;
  const next = normalizeEasHostInput(input, rest);
  if (input.token !== undefined && input.token !== null) {
    writeEasToken(host.id, input.token);
  }
  host.config = { id: host.id, ...next };
  save();

  return toWire(host);
}

/**
 * Stop every session the host started, then forget it. A session whose stop
 * fails keeps its record and the token, so the next sweep can still stop it.
 */
export async function removeEasDeviceHost(id: string): Promise<void> {
  const map = all();
  const host = map.get(id);
  if (!host) {
    throw "No such EAS Simulator host.";
  }
  for (const listener of removedListeners) {
    listener(id);
  }
  const running = host.runningSessions();
  await host.stopAll("host_removed");
  const outstanding = host.hasOutstanding();
  host.retire();
  map.delete(id);
  save();
  if (!outstanding) {
    writeEasToken(id, "");
    deleteLedger(id);
  }
  capture("eas_device_host_removed", {
    running_sessions: running,
    left_outstanding: outstanding,
  });
}

export function onEasDeviceHostRemoved(
  listener: (hostId: string) => void,
): () => void {
  removedListeners.add(listener);

  return () => removedListeners.delete(listener);
}

/** Who a credential signs in as: a draft token, a saved host's, or the fallbacks. */
export async function checkEasAccount(input: {
  hostId?: string | null;
  token?: string | null;
}): Promise<EasAccount> {
  const saved =
    input.token?.trim() ||
    (input.hostId ? readEasToken(input.hostId) : "") ||
    "";
  try {
    const credential = resolveExpoCredential(saved);
    const viewer = await makeExpoApi(credential).viewer();
    capture("eas_account_checked", {
      success: true,
      credential_source: credential.source,
      failure: "none",
    });

    return {
      signedInAs: viewer.name,
      credentialSource: credential.source,
      apps: viewer.apps,
    };
  } catch (e) {
    capture("eas_account_checked", {
      success: false,
      credential_source: "none",
      failure: e instanceof EasError ? e.failure : "api",
    });
    // Only bounded text leaves: the credential errors' own guidance, or a
    // category for what Expo answered, never Expo's text.
    if (e instanceof EasError && e.failure === "auth_rejected") {
      throw e.status
        ? `Expo rejected the credential (HTTP ${String(e.status)}).`
        : "Expo says no account is signed in with that credential.";
    }
    if (
      e instanceof EasError &&
      ["no_credential", "invalid_credential"].includes(e.failure)
    ) {
      throw e.message;
    }
    throw e instanceof EasError && e.rejected
      ? "Expo refused the account check."
      : "Could not complete the Expo account check.";
  }
}

/** The host behind an EAS device id that is running a session, if any. */
export function runningEasDevice(deviceId: string): boolean {
  const parsed = parseEasDeviceId(deviceId);

  return parsed
    ? (easHost(parsed.hostId)?.isRunning(parsed.slot) ?? false)
    : false;
}

/**
 * Start a billed session on a host's next free slot and return its device id.
 * The start takes minutes, so by default it runs on: the device shows up
 * booted once ready, and a failure lands on the host's `error`.
 */
export async function startEasSession(
  hostId: string,
  opts: { wait?: boolean } = {},
): Promise<string> {
  const host = easHost(hostId);
  if (!host) {
    throw "No such EAS Simulator host.";
  }
  const slot = host.nextSlot();
  if (slot === null) {
    throw `${host.config.label} is at its session limit. Close a session first.`;
  }
  try {
    // Fails fast on a missing credential, before anything is billed.
    host.api();
  } catch (e) {
    throw easMessage(e);
  }
  const opening = host.open(slot);
  if (opts.wait) {
    await opening.catch((e: unknown) => {
      throw easMessage(e);
    });
  } else {
    opening.catch((e: unknown) =>
      log.warn(`EAS session start failed: ${easMessage(e)}`),
    );
  }

  return easDeviceId(hostId, slot);
}

/** Stop the session behind an EAS device id; already stopped is fine. */
export async function stopEasSession(deviceId: string): Promise<void> {
  const parsed = parseEasDeviceId(deviceId);
  const host = parsed && easHost(parsed.hostId);
  if (!parsed || !host) {
    throw "No such EAS Simulator device.";
  }
  try {
    await host.close(parsed.slot, "closed");
  } catch (e) {
    throw easMessage(e);
  }
}

export function isEasDeviceId(deviceId: string): boolean {
  return deviceId.startsWith(EAS_ID_PREFIX);
}

function easStatus(h: EasHost): "connected" | "unknown" | "unreachable" {
  if (h.error) {
    return "unreachable";
  }

  return h.runningSessions() > 0 ? "connected" : "unknown";
}

/** EAS hosts as a paired client sees them: label and session counts only. */
export function remoteEasDeviceHosts(): {
  id: string;
  label: string;
  status: "connected" | "unknown" | "unreachable";
  kind: "eas";
  running_sessions: number;
  max_sessions: number;
}[] {
  return [...all().values()].map((h) => ({
    id: h.id,
    label: h.config.label,
    status: easStatus(h),
    kind: "eas",
    running_sessions: h.runningSessions(),
    max_sessions: h.config.maxConcurrentSessions,
  }));
}

/** Register the `eas:` device namespace and stop what earlier processes left running. */
export function initEasDeviceHosts(): void {
  unregister ??= registerDeviceSourceProvider(
    easDeviceProvider({
      host: easHost,
      hosts: () => [...all().values()],
      onRemoved: onEasDeviceHostRemoved,
    }),
  );
  for (const host of all().values()) {
    sweep(host);
  }
  // A removed host whose stops failed left its record (and token) behind.
  for (const id of ledgerHostIds()) {
    if (!all().has(id)) {
      const orphan = new EasHost(
        {
          id,
          label: "Removed EAS host",
          appId: null,
          maxSessionMinutes: 30,
          idleMinutes: 10,
          maxConcurrentSessions: 1,
        },
        { savedToken: () => readEasToken(id) },
      );
      orphan.adoptRecorded();
      sweepOrphan(orphan).catch(() => undefined);
    }
  }
}

function sweep(host: EasHost): void {
  try {
    host
      .reapLeftovers(host.api())
      .catch((e: unknown) =>
        log.warn(`sweep of ${host.id} failed`, easMessage(e)),
      );
  } catch {
    // No credential yet: listing sweeps once there is one.
  }
}

async function sweepOrphan(host: EasHost): Promise<void> {
  try {
    await host.reapLeftovers(host.api());
    if (!host.hasOutstanding()) {
      writeEasToken(host.id, "");
      deleteLedger(host.id);
    }
  } catch (e) {
    log.warn(`sweep of removed host ${host.id} failed`, easMessage(e));
  }
}

/**
 * Stop every session on the way out. Bounded: what doesn't stop in time stays
 * recorded, the next host process stops it, and Expo's own run and idle
 * limits end it regardless.
 */
export async function stopEasDeviceHosts(): Promise<void> {
  if (!hosts) {
    return;
  }
  const stops = Promise.all(
    [...hosts.values()].map((h) => h.stopAll("shutdown").catch(() => {})),
  );
  await Promise.race([
    stops,
    new Promise((r) => setTimeout(r, SHUTDOWN_WAIT_MS).unref?.()),
  ]);
}

/** Drop in-memory state so tests can start over. */
export function resetEasDeviceHostsForTests(): void {
  unregister?.();
  unregister = null;
  hosts = null;
  removedListeners.clear();
}
