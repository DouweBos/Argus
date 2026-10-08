/**
 * What is wrong with a simulator, in words a person can act on. simctl's own
 * errors are multi-line dumps with paths and NSError domains.
 */

import { existsSync } from "node:fs";

export type SimulatorProblemKind = "missing_data" | "unavailable";

export interface SimulatorProblem {
  kind: SimulatorProblemKind;
  message: string;
}

export type SimctlFailureReason =
  | "disk_full"
  | "missing_data"
  | "not_found"
  | "runtime_missing"
  | "timeout"
  | "unknown";

export interface SimctlFailure {
  reason: SimctlFailureReason;
  message: string;
}

/** The fields of a `simctl list devices --json` entry this reads. */
export interface SimctlDeviceHealth {
  isAvailable?: boolean;
  availabilityError?: string;
  dataPath?: string;
}

export const MISSING_DATA_MESSAGE = "This simulator's data is missing.";
const RUNTIME_MISSING_MESSAGE = "This simulator's runtime isn't installed.";

const RUNTIME_MISSING =
  /runtime profile not found|runtime .*(not available|unavailable|not found)/i;

/**
 * Flags a device that can't boot as listed: simctl marks one whose runtime is
 * gone, but still reports a device whose data directory was deleted as available.
 */
export function simulatorProblem(
  device: SimctlDeviceHealth,
  exists: (path: string) => boolean = existsSync,
): SimulatorProblem | undefined {
  if (device.isAvailable === false) {
    const error = device.availabilityError ?? "";

    return {
      kind: "unavailable",
      message: RUNTIME_MISSING.test(error)
        ? RUNTIME_MISSING_MESSAGE
        : "This simulator is unavailable.",
    };
  }
  if (device.dataPath && !exists(device.dataPath)) {
    return { kind: "missing_data", message: MISSING_DATA_MESSAGE };
  }

  return undefined;
}

const KNOWN: [RegExp, SimctlFailure][] = [
  [
    /cannot be located on disk|data is no longer present/i,
    { reason: "missing_data", message: MISSING_DATA_MESSAGE },
  ],
  [
    RUNTIME_MISSING,
    { reason: "runtime_missing", message: RUNTIME_MISSING_MESSAGE },
  ],
  [
    /invalid device|no such device|device not found/i,
    { reason: "not_found", message: "This simulator no longer exists." },
  ],
  [
    /no space left on device|ENOSPC/i,
    {
      reason: "disk_full",
      message: "Not enough disk space to boot this simulator.",
    },
  ],
  [
    /timed out|ETIMEDOUT/i,
    { reason: "timeout", message: "The simulator took too long to respond." },
  ],
];

/** Lines that only say an error happened, or which command failed. */
const NOISE =
  /^(error: )?command failed:|^an error was encountered processing the command|^underlying error|^use the device manager/i;

/** A simctl failure as a short sentence, with why it failed for telemetry. */
export function describeSimctlFailure(
  raw: string,
  action: "delete" | "erase" | "start" = "start",
): SimctlFailure {
  for (const [pattern, failure] of KNOWN) {
    if (pattern.test(raw)) {
      return failure;
    }
  }
  const line = raw
    .split("\n")
    .map((l) => l.trim())
    .find((l) => l.length > 0 && !NOISE.test(l));
  const detail = line ? line.slice(0, 200) : "";

  return {
    reason: "unknown",
    message: detail
      ? `Couldn't ${action} the simulator: ${detail}`
      : `Couldn't ${action} the simulator.`,
  };
}
