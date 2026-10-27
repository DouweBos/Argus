/** `simctl list` on a machine, turned into {@link SimulatorDevice}s. */

import type { SimulatorDevice } from "./deviceSource";
import type { DeviceMachine } from "../deviceHosts/machine";
import { type SimctlDeviceHealth, simulatorProblem } from "./simctlProblems";

interface SimctlOutput {
  devices: Record<string, SimctlDevice[]>;
}

interface SimctlDevice extends SimctlDeviceHealth {
  udid: string;
  name: string;
  state: string;
}

/**
 * Convert "com.apple.CoreSimulator.SimRuntime.iOS-18-0" to "iOS 18.0".
 *
 * The runtime key's last dot-separated component is e.g. "iOS-18-0".
 * We replace hyphens with spaces to get "iOS 18 0", then fixup the version
 * digits to use dots: "iOS 18.0".
 */
export function runtimeIdToHuman(runtimeId: string): string {
  const last = runtimeId.split(".").at(-1) ?? runtimeId;
  const spaced = last.replace(/-/g, " ");

  return fixupRuntimeVersion(spaced);
}

/**
 * Convert "iOS 18 0" → "iOS 18.0".
 *
 * Spaces between digit sequences become dots; spaces between a word and a
 * digit (e.g. "iOS 18") are preserved as-is.
 */
export function fixupRuntimeVersion(s: string): string {
  let result = "";
  let prevWasDigit = false;

  for (let i = 0; i < s.length; i++) {
    const ch = s[i];

    if (ch === " " && prevWasDigit) {
      // Peek ahead: if the next non-space char is a digit, emit a dot
      const next = s[i + 1];
      if (next !== undefined && /\d/.test(next)) {
        result += ".";
        prevWasDigit = false;
        continue;
      }
      // Otherwise fall through and emit the space normally
    }

    // If we just emitted a dot but the upcoming char is not a digit, fix it
    if (result.endsWith(".") && !/\d/.test(ch)) {
      result = result.slice(0, -1) + " ";
    }

    prevWasDigit = /\d/.test(ch);
    result += ch;
  }

  return result;
}

/**
 * Run `xcrun simctl list devices --json` on `machine`, convert runtime IDs to
 * human-readable strings (e.g. "iOS 18.0"), and sort booted devices first,
 * then alphabetically by name (case-insensitive). UDIDs are the machine's own.
 */
export async function listSimulatorsOn(
  machine: DeviceMachine,
  timeoutMs?: number,
): Promise<SimulatorDevice[]> {
  let stdout: string;
  try {
    ({ stdout } = await machine.exec(
      "xcrun",
      ["simctl", "list", "devices", "--json"],
      { timeoutMs },
    ));
  } catch (e) {
    throw `Failed to run xcrun simctl: ${String(e)}`;
  }

  let parsed: SimctlOutput;
  try {
    parsed = JSON.parse(stdout) as SimctlOutput;
  } catch (e) {
    throw `Failed to parse simctl JSON: ${String(e)}`;
  }

  const devices: SimulatorDevice[] = [];

  for (const [runtimeId, deviceList] of Object.entries(parsed.devices)) {
    const runtime = runtimeIdToHuman(runtimeId);
    for (const dev of deviceList) {
      const problem = simulatorProblem(dev);
      devices.push({
        udid: dev.udid,
        name: dev.name,
        runtime,
        booted: dev.state === "Booted",
        ...(problem ? { problem } : {}),
      });
    }
  }

  // Sort: booted first, then alphabetical by name (case-insensitive)
  devices.sort((a, b) => {
    if (a.booted !== b.booted) {
      return a.booted ? -1 : 1;
    }

    return a.name.toLowerCase().localeCompare(b.name.toLowerCase());
  });

  return devices;
}
