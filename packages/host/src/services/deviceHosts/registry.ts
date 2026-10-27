/**
 * Saved device hosts, their SSH masters and health. One multiplexing master
 * per host, restarted on demand; listing backs off a host that keeps failing
 * so a polling client doesn't hammer a Mac that's asleep.
 */

import type {
  DeviceHost,
  DeviceHostFailure,
  DeviceHostInput,
  DeviceHostTestResult,
} from "@argus/remote-protocol";
import type { ChildProcessWithoutNullStreams } from "node:child_process";
import { createLogger } from "@argus/host/logger";
import { capture } from "../telemetry/telemetry";
import {
  type DeviceHostConfig,
  loadDeviceHosts,
  newDeviceHostId,
  normalizeDeviceHostInput,
  saveDeviceHosts,
} from "./config";
import { parseDeviceId } from "./deviceId";
import { type DeviceMachine, SshMachine, localMachine } from "./machine";
import {
  FAILURE_MESSAGES,
  classifySshFailure,
  runSsh,
  sshBaseArgs,
  sshMasterArgs,
  sshSpawn,
} from "./ssh";

const log = createLogger("deviceHosts");

interface HostRuntime {
  config: DeviceHostConfig;
  error: string | null;
  failures: number;
  machine: SshMachine;
  master: ChildProcessWithoutNullStreams | null;
  nextAttemptAt: number;
  status: DeviceHost["status"];
}

let hosts: Map<string, HostRuntime> | null = null;
const removedListeners = new Set<(hostId: string) => void>();

const BACKOFF_BASE_MS = 2_000;
const BACKOFF_MAX_MS = 60_000;

function runtimeFor(config: DeviceHostConfig): HostRuntime {
  const rt: HostRuntime = {
    config,
    error: null,
    failures: 0,
    master: null,
    nextAttemptAt: 0,
    status: "unknown",
    machine: undefined as unknown as SshMachine,
  };
  rt.machine = new SshMachine(config, {
    ensureMaster: () => ensureMaster(rt),
    onSshFailure: (stderr) => markFailure(rt, stderr),
    onSuccess: () => markSuccess(rt),
  });

  return rt;
}

function all(): Map<string, HostRuntime> {
  if (!hosts) {
    hosts = new Map(loadDeviceHosts().map((c) => [c.id, runtimeFor(c)]));
  }

  return hosts;
}

function markFailure(rt: HostRuntime, stderr: string): void {
  rt.failures += 1;
  rt.status = "unreachable";
  rt.error = FAILURE_MESSAGES[classifySshFailure(stderr)];
  rt.nextAttemptAt =
    Date.now() +
    Math.min(BACKOFF_MAX_MS, BACKOFF_BASE_MS * 2 ** (rt.failures - 1));
}

function markSuccess(rt: HostRuntime): void {
  rt.failures = 0;
  rt.status = "connected";
  rt.error = null;
  rt.nextAttemptAt = 0;
}

function ensureMaster(rt: HostRuntime): void {
  if (rt.master || Date.now() < rt.nextAttemptAt) {
    return;
  }
  const child = sshSpawn(sshMasterArgs(rt.config));
  rt.master = child;
  let stderr = "";
  child.stderr.on("data", (c: Buffer) => {
    stderr += c.toString();
  });
  child.stdin.on("error", () => {});
  child.on("error", (e) => log.warn(`master for ${rt.config.id} failed`, e));
  child.on("close", (code) => {
    if (rt.master === child) {
      rt.master = null;
    }
    if (code === 255) {
      markFailure(rt, stderr);
    }
    log.info(`master for ${rt.config.id} exited (${String(code)})`);
  });
}

function stopMaster(rt: HostRuntime): void {
  rt.master?.kill();
  rt.master = null;
}

function toWire(rt: HostRuntime): DeviceHost {
  return {
    id: rt.config.id,
    label: rt.config.label,
    target: rt.config.target,
    port: rt.config.port,
    identityFile: rt.config.identityFile,
    status: rt.status,
    error: rt.error,
  };
}

export function listDeviceHosts(): DeviceHost[] {
  return [...all().values()].map(toWire);
}

export function addDeviceHost(input: DeviceHostInput): DeviceHost {
  const normalized = normalizeDeviceHostInput(input);
  const map = all();
  for (const rt of map.values()) {
    if (
      rt.config.target === normalized.target &&
      rt.config.port === normalized.port
    ) {
      throw `${normalized.target} is already a device host.`;
    }
  }
  const config: DeviceHostConfig = { id: newDeviceHostId(), ...normalized };
  saveDeviceHosts([...[...map.values()].map((rt) => rt.config), config]);
  const rt = runtimeFor(config);
  map.set(config.id, rt);
  capture("device_host_added", {
    has_identity_file: config.identityFile !== null,
    has_port: config.port !== null,
  });

  return toWire(rt);
}

/** Stop the host's captures and SSH master; its simulators keep running. */
export function removeDeviceHost(id: string): void {
  const map = all();
  const rt = map.get(id);
  if (!rt) {
    throw "No such device host.";
  }
  for (const listener of removedListeners) {
    listener(id);
  }
  stopMaster(rt);
  map.delete(id);
  saveDeviceHosts([...map.values()].map((r) => r.config));
  capture("device_host_removed");
}

/** Lets the simulator layer drop a removed host's captures without a cycle. */
export function onDeviceHostRemoved(
  listener: (hostId: string) => void,
): () => void {
  removedListeners.add(listener);

  return () => removedListeners.delete(listener);
}

/** A saved host's machine and label; throws when it was removed. */
export function deviceHostMachine(hostId: string): ReachableHost {
  const rt = all().get(hostId);
  if (!rt) {
    throw "That device's host was removed from Settings → Tools → Device hosts.";
  }

  return { config: rt.config, machine: rt.machine };
}

/** The machine a device id lives on; throws when its host was removed. */
export function machineForDevice(deviceId: string): {
  machine: DeviceMachine;
  udid: string;
} {
  const { hostId, udid } = parseDeviceId(deviceId);
  if (!hostId) {
    return { machine: localMachine, udid };
  }

  return { machine: deviceHostMachine(hostId).machine, udid };
}

export interface ReachableHost {
  config: DeviceHostConfig;
  machine: DeviceMachine;
}

/** Hosts worth asking for devices right now (not backing off). */
export function reachableDeviceHosts(): ReachableHost[] {
  const now = Date.now();

  return [...all().values()]
    .filter((rt) => now >= rt.nextAttemptAt)
    .map((rt) => ({ config: rt.config, machine: rt.machine }));
}

export function deviceHostLabel(hostId: string): string | undefined {
  return all().get(hostId)?.config.label;
}

/** Probe script: fixed text, nothing user-supplied reaches the remote shell. */
const PROBE = [
  "uname -s",
  "uname -m",
  "sw_vers -productVersion 2>/dev/null || echo -",
  "xcrun simctl help >/dev/null 2>&1 && echo simctl-ok || echo simctl-missing",
].join("; ");

/** Parse the probe's four lines into a verdict. */
export function interpretProbe(stdout: string): DeviceHostTestResult {
  const [os = "", arch = "", version = "", simctl = ""] = stdout
    .trim()
    .split("\n")
    .map((l) => l.trim());
  const macosVersion = version && version !== "-" ? version : null;
  const base = { arch: arch || null, macosVersion };
  const fail = (failure: DeviceHostFailure): DeviceHostTestResult => ({
    ...base,
    ok: false,
    failure,
    message: FAILURE_MESSAGES[failure],
  });
  if (os !== "Darwin") {
    return fail("not_macos");
  }
  if (arch !== "arm64") {
    return fail("unsupported_arch");
  }
  if (simctl !== "simctl-ok") {
    return fail("no_xcode");
  }

  return {
    ...base,
    ok: true,
    failure: null,
    message: `Connected: macOS ${macosVersion ?? "?"} on ${arch}, Xcode ready.`,
  };
}

/** Check SSH and prerequisites for a draft or saved host. Installs nothing. */
export async function testDeviceHost(
  input: DeviceHostInput,
): Promise<DeviceHostTestResult> {
  const result = await probe(input);
  capture("device_host_tested", {
    success: result.ok,
    failure: result.failure ?? "none",
  });
  const saved = [...all().values()].find(
    (rt) =>
      rt.config.target === input.target.trim() &&
      rt.config.port === (input.port ?? null),
  );
  if (saved) {
    if (result.ok) {
      markSuccess(saved);
    } else {
      saved.status = "unreachable";
      saved.error = result.message;
    }
  }

  return result;
}

async function probe(input: DeviceHostInput): Promise<DeviceHostTestResult> {
  let config: DeviceHostConfig;
  try {
    config = { id: "rh00000000", ...normalizeDeviceHostInput(input) };
  } catch (e) {
    return {
      ok: false,
      failure: "invalid_config",
      message: String(e),
      arch: null,
      macosVersion: null,
    };
  }
  try {
    const res = await runSsh([...sshBaseArgs(config), PROBE], {
      timeoutMs: 20_000,
    });
    if (res.code === 255 || res.code === null) {
      const failure =
        res.code === null ? "timeout" : classifySshFailure(res.stderr);

      return {
        ok: false,
        failure,
        message: detail(FAILURE_MESSAGES[failure], res.stderr),
        arch: null,
        macosVersion: null,
      };
    }

    return interpretProbe(res.stdout);
  } catch (e) {
    return {
      ok: false,
      failure: "unknown",
      message: `Couldn't run ssh: ${String(e)}`,
      arch: null,
      macosVersion: null,
    };
  }
}

/** ssh's last stderr line, which names the actual problem. */
function detail(message: string, stderr: string): string {
  const last = stderr
    .trim()
    .split("\n")
    .filter((l) => !l.startsWith("Warning: Permanently added"))
    .pop();

  return last ? `${message} (${last.trim()})` : message;
}

/** Kill every master. Called on host shutdown. */
export function stopDeviceHosts(): void {
  for (const rt of hosts?.values() ?? []) {
    stopMaster(rt);
  }
}

/** Drop in-memory state so tests can start over. */
export function resetDeviceHostsForTests(): void {
  stopDeviceHosts();
  hosts = null;
}
