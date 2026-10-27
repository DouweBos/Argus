/**
 * Erase or delete a simulator: the two ways out of a device simctl can't
 * boot, such as one whose data folder was removed.
 */

import { warn } from "@argus/host/logger";
import { capture } from "../telemetry/telemetry";
import { requireCapability, resolveDeviceSource } from "./deviceSources";
import { disconnectSimulator } from "./ios";
import { describeSimctlFailure } from "./simctlProblems";

/** Both need a shut-down device; one that already is says so, which is fine. */
async function shutDown(udid: string): Promise<void> {
  disconnectSimulator(udid);
  const source = resolveDeviceSource(udid);
  try {
    await source.close(udid);
  } catch {
    // Already shut down, or missing: erase/delete report what matters.
  }
}

async function run(action: "delete" | "erase", udid: string): Promise<void> {
  requireCapability(udid, action);
  await shutDown(udid);
  const source = resolveDeviceSource(udid);
  try {
    await source[action](udid);
    capture("simulator_repaired", { action, success: true });
  } catch (e) {
    warn(`[Simulator] ${action} failed for ${udid}:`, e);
    capture("simulator_repaired", { action, success: false });
    throw describeSimctlFailure(String(e), action).message;
  }
}

/** Resets the simulator to a fresh install, recreating a missing data folder. */
export function eraseSimulator(udid: string): Promise<void> {
  return run("erase", udid);
}

export function deleteSimulator(udid: string): Promise<void> {
  return run("delete", udid);
}
