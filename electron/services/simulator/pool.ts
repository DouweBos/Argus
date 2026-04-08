/**
 * Simulator pool — manages a set of project-prefixed iOS simulators so each
 * agent gets its own dedicated device.
 *
 * Simulators are named `{ProjectName}-{N}` (e.g. `MyApp-1`, `MyApp-2`).
 * When an agent needs a simulator the pool either reuses a free one or creates
 * a new one automatically. On release the installed app is uninstalled via
 * conductor so the device is clean for the next agent.
 */

import { execFile } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import { appState, type SimulatorReservation } from "../../state";
import { bootSimulator, listSimulators } from "./ios";

const execFileAsync = promisify(execFile);

const CONDUCTOR_BIN = path.join(os.homedir(), ".stagehand", "bin", "conductor");

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** Derive the project prefix from the repo root directory name. */
export function projectPrefix(repoRoot: string): string {
  return path.basename(repoRoot);
}

/**
 * Find the smallest N (starting at 1) where `{prefix}-{N}` is not already
 * taken, filling gaps in the sequence.
 */
export function nextDeviceName(
  prefix: string,
  existingNames: string[],
): string {
  const taken = new Set(existingNames);
  let n = 1;
  while (taken.has(`${prefix}-${n}`)) {
    n++;
  }
  return `${prefix}-${n}`;
}

/**
 * Extract the numeric generation from an iPhone device type name.
 * "iPhone 16 Pro Max" → 16, "iPhone 6s Plus" → 6, "iPhone X" → 10.
 */
export function iphoneModelNumber(name: string): number {
  const num = name.match(/^iPhone\s+(\d+)/);
  if (num) return parseInt(num[1], 10);
  // iPhone X, XS, XR, XS Max are all generation 10.
  if (/^iPhone\s+X/i.test(name)) return 10;
  return 0;
}

/** Query simctl for the latest available iPhone device type identifier. */
async function resolveLatestDeviceType(): Promise<string> {
  const { stdout } = await execFileAsync("xcrun", [
    "simctl",
    "list",
    "devicetypes",
    "--json",
  ]);
  const parsed = JSON.parse(stdout) as {
    devicetypes: { identifier: string; name: string }[];
  };

  const iphones = parsed.devicetypes.filter(
    (dt) => dt.name.startsWith("iPhone") && !dt.name.includes("SE"),
  );

  if (iphones.length === 0) {
    throw "No iPhone device type found in simctl";
  }

  // Sort: highest model first, then shortest name (base model over Pro Max).
  iphones.sort((a, b) => {
    const diff = iphoneModelNumber(b.name) - iphoneModelNumber(a.name);
    return diff !== 0 ? diff : a.name.length - b.name.length;
  });

  return iphones[0].identifier;
}

/** Query simctl for the latest available iOS runtime identifier. */
async function resolveLatestRuntime(): Promise<string> {
  const { stdout } = await execFileAsync("xcrun", [
    "simctl",
    "list",
    "runtimes",
    "--json",
  ]);
  const parsed = JSON.parse(stdout) as {
    runtimes: { identifier: string; name: string; isAvailable: boolean }[];
  };

  // Walk backwards (newest first) and find the first available iOS runtime.
  for (let i = parsed.runtimes.length - 1; i >= 0; i--) {
    const rt = parsed.runtimes[i];
    if (rt.isAvailable && rt.name.startsWith("iOS")) {
      return rt.identifier;
    }
  }

  throw "No available iOS runtime found in simctl";
}

/**
 * Create a new simulator with the given name and return its UDID.
 *
 * Uses the latest available iPhone device type and iOS runtime by default.
 */
async function createSimulator(name: string): Promise<string> {
  const [deviceType, runtime] = await Promise.all([
    resolveLatestDeviceType(),
    resolveLatestRuntime(),
  ]);

  const { stdout } = await execFileAsync("xcrun", [
    "simctl",
    "create",
    name,
    deviceType,
    runtime,
  ]);

  // simctl create prints just the UDID followed by a newline.
  const udid = stdout.trim();
  if (!udid) {
    throw `simctl create returned empty output for "${name}"`;
  }

  console.info(
    `[simulator-pool] Created "${name}" (${udid}) — ${deviceType} / ${runtime}`,
  );
  return udid;
}

/**
 * Best-effort cleanup: uninstall the app and clear the conductor session for
 * the given device. Errors are logged but never thrown.
 */
async function cleanupDevice(udid: string): Promise<void> {
  try {
    await execFileAsync(CONDUCTOR_BIN, ["uninstall-app", "--device", udid]);
  } catch {
    // No app installed, or conductor not available — that's fine.
  }

  try {
    await execFileAsync(CONDUCTOR_BIN, [
      "session",
      "--clear",
      "--device",
      udid,
    ]);
  } catch {
    // Session might not exist — that's fine.
  }
}

// ---------------------------------------------------------------------------
// SimulatorPool
// ---------------------------------------------------------------------------

class SimulatorPool {
  /**
   * Serialization queue: each acquisition/release chains onto this promise so
   * concurrent calls don't race on simulator creation or reservation checks.
   */
  private pendingOp: Promise<void> = Promise.resolve();

  /**
   * Acquire a dedicated simulator for an agent.
   *
   * Finds a free project-prefixed simulator or creates one, boots it, records
   * the reservation, and returns the UDID.
   */
  async acquireSimulator(agentId: string, repoRoot: string): Promise<string> {
    return new Promise<string>((resolve, reject) => {
      this.pendingOp = this.pendingOp
        .then(async () => {
          const udid = await this.doAcquire(agentId, repoRoot);
          resolve(udid);
        })
        .catch((e) => {
          reject(e);
        });
    });
  }

  /**
   * Release a simulator reservation and clean up the device.
   *
   * Idempotent — safe to call from both `stopAgent` and the process `close`
   * handler without worrying about double-release.
   */
  async releaseSimulator(agentId: string): Promise<void> {
    return new Promise<void>((resolve) => {
      this.pendingOp = this.pendingOp
        .then(async () => {
          await this.doRelease(agentId);
          resolve();
        })
        .catch(() => {
          // Release must always succeed from the caller's perspective.
          resolve();
        });
    });
  }

  /** Get the reserved UDID for an agent, or null. */
  getReservedUdid(agentId: string): string | null {
    return appState.simulatorReservations.get(agentId)?.udid ?? null;
  }

  // -------------------------------------------------------------------------
  // Internal
  // -------------------------------------------------------------------------

  private async doAcquire(agentId: string, repoRoot: string): Promise<string> {
    const prefix = projectPrefix(repoRoot);
    const allDevices = await listSimulators();
    const projectDevices = allDevices.filter((d) =>
      d.name.startsWith(`${prefix}-`),
    );

    // Collect UDIDs that are already reserved by other agents.
    const reservedUdids = new Set<string>();
    for (const r of appState.simulatorReservations.values()) {
      reservedUdids.add(r.udid);
    }

    // Try to find a free (unreserved) project simulator.
    const free = projectDevices.find((d) => !reservedUdids.has(d.udid));

    let udid: string;
    let deviceName: string;

    if (free) {
      udid = free.udid;
      deviceName = free.name;

      if (!free.booted) {
        await bootSimulator(udid);
      }

      console.info(
        `[simulator-pool] Reusing "${deviceName}" (${udid}) for agent ${agentId}`,
      );
    } else {
      // No free simulator — create one.
      deviceName = nextDeviceName(
        prefix,
        projectDevices.map((d) => d.name),
      );
      udid = await createSimulator(deviceName);
      await bootSimulator(udid);
    }

    const reservation: SimulatorReservation = {
      agentId,
      udid,
      deviceName,
      repoRoot,
    };
    appState.simulatorReservations.set(agentId, reservation);

    console.info(
      `[simulator-pool] Reserved "${deviceName}" (${udid}) → agent ${agentId}`,
    );
    return udid;
  }

  private async doRelease(agentId: string): Promise<void> {
    const reservation = appState.simulatorReservations.get(agentId);
    if (!reservation) return; // Already released or never acquired.

    console.info(
      `[simulator-pool] Releasing "${reservation.deviceName}" (${reservation.udid}) from agent ${agentId}`,
    );

    await cleanupDevice(reservation.udid);
    appState.simulatorReservations.delete(agentId);
  }
}

/** Singleton pool instance. */
export const simulatorPool = new SimulatorPool();
