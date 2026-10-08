/**
 * Erase or delete a simulator: the two ways out of a device simctl can't
 * boot, such as one whose data folder was removed.
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { warn } from "@argus/host/logger";
import { capture } from "../telemetry/telemetry";
import { disconnectSimulator } from "./ios";
import { describeSimctlFailure } from "./simctlProblems";

const execFileAsync = promisify(execFile);

/** Both need a shut-down device; one that already is says so, which is fine. */
async function shutDown(udid: string): Promise<void> {
  disconnectSimulator(udid);
  try {
    await execFileAsync("xcrun", ["simctl", "shutdown", udid]);
  } catch {
    // Already shut down, or missing: erase/delete report what matters.
  }
}

async function run(action: "delete" | "erase", udid: string): Promise<void> {
  await shutDown(udid);
  try {
    await execFileAsync("xcrun", ["simctl", action, udid]);
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
