/**
 * iOS Simulator control.
 *
 * Runs xcrun simctl commands via child_process.execFile and delegates
 * framebuffer capture / HID injection to SimBridge (bridge.ts).
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { appState } from "../../state";
import { SimBridge } from "./bridge";

const execFileAsync = promisify(execFile);

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/** A discovered iOS simulator device. */
export interface SimulatorDevice {
  udid: string;
  name: string;
  runtime: string;
  booted: boolean;
}

// ---------------------------------------------------------------------------
// simctl JSON shape
// ---------------------------------------------------------------------------

interface SimctlOutput {
  devices: Record<string, SimctlDevice[]>;
}

interface SimctlDevice {
  udid: string;
  name: string;
  state: string;
}

// ---------------------------------------------------------------------------
// Runtime ID helpers
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// IPC-facing functions
// ---------------------------------------------------------------------------

/**
 * Check whether Xcode Command Line Tools (xcrun + simctl) are available.
 *
 * Resolves on success, throws a user-facing message on failure.
 */
export async function checkIosTools(): Promise<void> {
  try {
    await execFileAsync("xcrun", ["simctl", "help"]);
  } catch {
    throw "Xcode Command Line Tools not found. Install them by running: xcode-select --install";
  }
}

/**
 * List all available iOS simulator devices.
 *
 * Runs `xcrun simctl list devices --json`, converts runtime IDs to
 * human-readable strings (e.g. "iOS 18.0"), and sorts booted devices first,
 * then alphabetically by name (case-insensitive).
 */
export async function listSimulators(): Promise<SimulatorDevice[]> {
  let stdout: string;
  try {
    ({ stdout } = await execFileAsync("xcrun", [
      "simctl",
      "list",
      "devices",
      "--json",
    ]));
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
      devices.push({
        udid: dev.udid,
        name: dev.name,
        runtime,
        booted: dev.state === "Booted",
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

/**
 * Boot a simulator by UDID and open Simulator.app.
 *
 * "Already booted" is not treated as an error, mirroring the Rust
 * implementation's tolerance for the "Booted" error message from simctl.
 */
export async function bootSimulator(udid: string): Promise<void> {
  try {
    await execFileAsync("xcrun", ["simctl", "boot", udid]);
  } catch (e) {
    const msg = String(e);
    // simctl exits non-zero with "Unable to boot device in current state: Booted"
    // when the device is already running — that is not a real error.
    if (!msg.includes("Booted")) {
      throw `Failed to boot simulator: ${msg}`;
    }
  }

  // Bring Simulator.app to the foreground showing this device
  activateSimulatorWindow(udid);
}

/**
 * Switch Simulator.app to display the given device.
 *
 * Required when multiple simulators are booted — the app shows one at a time
 * and framebuffer capture only works for the currently displayed device.
 * Fire-and-forget: failures are silently ignored.
 */
function activateSimulatorWindow(udid: string): void {
  execFile(
    "open",
    ["-g", "-a", "Simulator", "--args", "-CurrentDeviceUDID", udid],
    () => {
      // Ignore errors — Simulator.app may not be installed
    },
  );
}

/**
 * Stop capture for the given UDID if it is the active session, then clear the
 * simulator state.
 */
export function disconnectSimulator(udid: string): void {
  if (appState.simulator?.udid === udid) {
    stopSimulatorCapture();
    appState.simulator = null;
  }
}

/**
 * Return the UDID of the first booted simulator, or null if none are booted.
 */
export async function activeSimulator(): Promise<string | null> {
  const devices = await listSimulators();

  return devices.find((d) => d.booted)?.udid ?? null;
}

/**
 * Start capturing the simulator framebuffer and serving MJPEG.
 *
 * Activates the simulator window, spawns the bridge binary (if not already
 * running), sends a `start_capture` command, stores the session in appState,
 * and returns the MJPEG port.
 */
export async function startSimulatorCapture(udid: string): Promise<number> {
  // Resolve the human-readable device name for the session record
  const devices = await listSimulators();
  const device = devices.find((d) => d.udid === udid);
  if (!device) {
    throw `No simulator found with UDID ${udid}`;
  }

  // Ensure Simulator.app is showing this device before capture
  activateSimulatorWindow(udid);

  // Spawn the bridge binary if it is not already running
  const bridge = SimBridge.instance ?? new SimBridge();
  SimBridge.instance = bridge;
  bridge.spawn();

  const response = await bridge.sendCommand({ cmd: "start_capture", udid });
  if (!response.ok) {
    throw `Bridge start_capture failed: ${String(response.error ?? "unknown error")}`;
  }

  const port = response.port as number;

  appState.simulator = {
    udid,
    deviceName: device.name,
    captureActive: true,
    mjpegPort: port,
  };

  return port;
}

/**
 * Stop the active simulator capture session.
 *
 * Sends `stop_capture` to the bridge and clears appState.simulator.
 * No-ops if no session is active.
 */
export function stopSimulatorCapture(): void {
  const bridge = SimBridge.instance;
  if (bridge) {
    // Best-effort — ignore errors on teardown
    bridge.sendCommand({ cmd: "stop_capture" }).catch(() => {});
    bridge.kill();
    SimBridge.instance = null;
  }

  appState.simulator = null;
}

/**
 * Inject a touch event into the simulator via the bridge.
 *
 * `x` and `y` are normalized coordinates in [0.0, 1.0].
 * `eventType`: 0 = Down, 1 = Drag, 2 = Up.
 *
 * @throws string if there is no active simulator session for this UDID, or if
 *   the bridge returns an error.
 */
export async function simulatorTouch(
  udid: string,
  x: number,
  y: number,
  eventType: number,
): Promise<void> {
  if (!appState.simulator || appState.simulator.udid !== udid) {
    throw "No active simulator session";
  }

  const bridge = SimBridge.instance;
  if (!bridge) {
    throw "Simulator bridge is not running";
  }

  const response = await bridge.sendCommand({
    cmd: "touch",
    udid,
    x,
    y,
    type: eventType,
  });
  if (!response.ok) {
    throw `Touch failed: ${String(response.error ?? "unknown error")}`;
  }
}

/**
 * Send a named button press (e.g. "home", "menu") to the active simulator.
 *
 * The bridge maps button names to macOS virtual keycodes and issues a
 * down+up pair.
 *
 * @throws string if there is no active session, or the bridge returns an error.
 */
export async function simulatorButton(button: string): Promise<void> {
  const udid = appState.simulator?.udid;
  if (!udid) {
    throw "No active simulator session";
  }

  const bridge = SimBridge.instance;
  if (!bridge) {
    throw "Simulator bridge is not running";
  }

  const response = await bridge.sendCommand({ cmd: "button", udid, button });
  if (!response.ok) {
    throw `Button failed: ${String(response.error ?? "unknown error")}`;
  }
}

/**
 * Send a raw keyboard event (down or up) to the active simulator.
 *
 * Unlike {@link simulatorButton}, this accepts an arbitrary macOS virtual
 * keycode and modifier flags with no name mapping and no automatic down+up
 * pairing.
 *
 * @throws string if there is no active session, or the bridge returns an error.
 */
export async function simulatorKeyboard(
  keyCode: number,
  modifierFlags: number,
  isDown: boolean,
): Promise<void> {
  const udid = appState.simulator?.udid;
  if (!udid) {
    throw "No active simulator session";
  }

  const bridge = SimBridge.instance;
  if (!bridge) {
    throw "Simulator bridge is not running";
  }

  const response = await bridge.sendCommand({
    cmd: "keyboard",
    udid,
    keyCode,
    modifierFlags,
    isDown,
  });
  if (!response.ok) {
    throw `Keyboard failed: ${String(response.error ?? "unknown error")}`;
  }
}
