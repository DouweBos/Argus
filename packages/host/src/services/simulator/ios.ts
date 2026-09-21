/**
 * iOS Simulator control.
 *
 * Runs xcrun simctl commands via child_process.execFile and delegates
 * framebuffer capture and touch injection to SimBridge (bridge.ts). Keyboard
 * and hardware buttons go through SimInput (simInput.ts) instead — the Indigo
 * path SimBridge uses only still carries digitizer events.
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { warn } from "@argus/host/logger";
import { hostPlatform } from "@argus/host/platform";
import { appState } from "../../state";
import { SimBridge } from "./bridge";
import {
  type DeviceOrientation,
  type DisplayInfo,
  type FoldPose,
  type SimulatorDeviceState,
  forgetSimulatorDeviceState,
  getSimulatorDeviceState,
  publishSimulatorDeviceState,
  rotationForUiOrientation,
  setSimulatorFold,
  setSimulatorOrientation,
} from "./deviceState";
import {
  HID_CONSUMER_USAGE,
  HID_PAGE_CONSUMER,
  HID_PAGE_KEYBOARD,
  hidUsageForKeyCode,
  modifierUsages,
} from "./hidUsage";
import { startIosVideoStream, stopIosVideoStream } from "./ios-video";
import { sendButtonUsage, sendKeyUsage, stopSimInput } from "./simInput";

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
 * Stop capture for the given UDID if a session is active, then clear the
 * simulator state for that UDID. Also closes any floating popout window
 * mirroring this device — once the simulator is gone there's nothing for
 * the popout to show.
 */
export function disconnectSimulator(udid: string): void {
  if (appState.simulators.has(udid)) {
    forceStopSimulatorCapture(udid);
  }

  hostPlatform().closeDevicePopout(`ios:${udid}`);
}

/**
 * Return the UDID of the first booted simulator, or null if none are booted.
 */
export async function activeSimulator(): Promise<string | null> {
  const devices = await listSimulators();

  return devices.find((d) => d.booted)?.udid ?? null;
}

/**
 * Per-UDID bridge registry. Each captured simulator runs its own native
 * bridge process with its own MJPEG server, so N simulators can be streamed
 * concurrently (one popout per device, independent of the main window).
 */
const bridgesByUdid = new Map<string, SimBridge>();

/**
 * Per-UDID reference counts — the main window's runtime view plus any popout
 * windows each hold one ref. The bridge for a UDID is torn down only when
 * its count hits zero, so closing one popout doesn't kill streams for other
 * devices.
 */
const captureRefsByUdid = new Map<string, number>();

/**
 * In-flight capture spawns, keyed by UDID. Guards the non-atomic
 * check-then-spawn in {@link startSimulatorCapture} so concurrent starts for
 * the same device share one bridge instead of racing to spawn duplicates.
 */
const startInFlightByUdid = new Map<string, Promise<number>>();

/**
 * Per-UDID deferred-teardown timers. When the last view holding a capture
 * unmounts, refs hit zero and we *schedule* a tear-down instead of running
 * it immediately — so a quick close/reopen reuses the existing bridge.
 * Cancelled when {@link startSimulatorCapture} sees a pending entry for the
 * same UDID; fires {@link forceStopSimulatorCapture} after the grace period.
 */
const pendingTeardownByUdid = new Map<string, ReturnType<typeof setTimeout>>();

const TEARDOWN_GRACE_MS = 10 * 60 * 1000;

function cancelPendingTeardown(udid: string): void {
  const timer = pendingTeardownByUdid.get(udid);
  if (timer) {
    clearTimeout(timer);
    pendingTeardownByUdid.delete(udid);
  }
}

/**
 * Return the bridge handling the given UDID, or null if none is running.
 *
 * Exposed so HID commands (touch/button/keyboard) can route their requests
 * to the bridge process that owns the capture session for a specific device.
 */
export function getBridgeForUdid(udid: string): SimBridge | null {
  return bridgesByUdid.get(udid) ?? null;
}

/** Whether a capture session is currently active for this UDID. */
export function isSimulatorCapturing(udid: string): boolean {
  return (captureRefsByUdid.get(udid) ?? 0) > 0;
}

/**
 * Acquire a capture session for the given UDID and return the MJPEG port.
 *
 * If a session is already active for this UDID, just increments its ref
 * count and returns the existing port. Otherwise spawns a new bridge
 * process dedicated to this UDID — other simulators keep streaming
 * unaffected.
 */
export async function startSimulatorCapture(udid: string): Promise<number> {
  // A previous holder dropped to zero refs but the grace timer hasn't fired
  // yet — reclaim the bridge instead of letting it be torn down.
  cancelPendingTeardown(udid);

  // Fast path: reuse existing capture for the same device.
  const existing = appState.simulators.get(udid);
  const existingBridge = bridgesByUdid.get(udid);
  if (existing?.mjpegPort != null && existingBridge) {
    captureRefsByUdid.set(udid, (captureRefsByUdid.get(udid) ?? 0) + 1);

    return existing.mjpegPort;
  }

  // A spawn is already in flight for this UDID — the check-then-spawn above is
  // not atomic across the awaits below, so two near-simultaneous starts (the
  // desktop view opening + a remote watch, or a StrictMode double-invoke) would
  // otherwise each spawn a bridge and clobber the registry. Join the in-flight
  // spawn and just add our own reference once it completes.
  const inflight = startInFlightByUdid.get(udid);
  if (inflight) {
    const port = await inflight;
    captureRefsByUdid.set(udid, (captureRefsByUdid.get(udid) ?? 0) + 1);

    return port;
  }

  const spawn = spawnSimulatorCapture(udid);
  startInFlightByUdid.set(udid, spawn);
  try {
    return await spawn;
  } finally {
    startInFlightByUdid.delete(udid);
  }
}

/** Actually spawn the bridge + start capture. Serialized per UDID by the
 *  in-flight guard in {@link startSimulatorCapture}; sets the ref count to 1. */
async function spawnSimulatorCapture(udid: string): Promise<number> {
  // Resolve the human-readable device name for the session record
  const devices = await listSimulators();
  const device = devices.find((d) => d.udid === udid);
  if (!device) {
    throw `No simulator found with UDID ${udid}`;
  }

  // Ensure Simulator.app is showing this device before capture
  activateSimulatorWindow(udid);

  // Spawn a new bridge binary dedicated to this UDID.
  const bridge = new SimBridge();
  bridgesByUdid.set(udid, bridge);
  bridge.spawn();

  let response: Record<string, unknown>;
  try {
    response = await bridge.sendCommand({ cmd: "start_capture", udid });
  } catch (err) {
    bridge.kill();
    bridgesByUdid.delete(udid);
    throw `Bridge start_capture failed: ${String(err)}`;
  }
  if (!response.ok) {
    bridge.kill();
    bridgesByUdid.delete(udid);
    throw `Bridge start_capture failed: ${String(response.error ?? "unknown error")}`;
  }

  const port = response.port as number;

  // Connect to the bridge's raw H.264 stream and forward frames to the
  // renderer's WebCodecs decoder via IPC.
  startIosVideoStream(udid, port);

  appState.simulators.set(udid, {
    udid,
    deviceName: device.name,
    captureActive: true,
    mjpegPort: port,
  });
  captureRefsByUdid.set(udid, 1);

  // The hinge and orientation drive how the view has to present the stream, so
  // they need watching for as long as there is one.
  startDeviceStatePolling(udid);

  return port;
}

/**
 * Release one reference to the capture session for the given UDID. If this
 * was the last holder, schedule a deferred teardown — the bridge stays
 * alive for {@link TEARDOWN_GRACE_MS} so a re-mounting view (route change,
 * dialog reopen) can reclaim it without respawning the native binary. If
 * no view comes back within the grace period, the bridge is force-stopped.
 * No-ops if nothing is active for this UDID.
 */
export function stopSimulatorCapture(udid: string): void {
  const refs = captureRefsByUdid.get(udid) ?? 0;
  if (refs > 1) {
    captureRefsByUdid.set(udid, refs - 1);

    return;
  }
  if (refs === 0) {
    return;
  }
  captureRefsByUdid.set(udid, 0);

  cancelPendingTeardown(udid);
  const timer = setTimeout(() => {
    pendingTeardownByUdid.delete(udid);
    forceStopSimulatorCapture(udid);
  }, TEARDOWN_GRACE_MS);
  timer.unref?.();
  pendingTeardownByUdid.set(udid, timer);
}

/**
 * Unconditionally stop the capture session for the given UDID, regardless
 * of outstanding references. Used for hard-disconnect flows (user clicks
 * Disconnect, device switch) where we want the stream down immediately.
 */
export function forceStopSimulatorCapture(udid: string): void {
  stopIosVideoStream(udid);
  stopSimInput(udid);
  stopDeviceStatePolling(udid);
  forgetSimulatorDeviceState(udid);

  const bridge = bridgesByUdid.get(udid);
  if (bridge) {
    // Best-effort — ignore errors on teardown
    bridge.sendCommand({ cmd: "stop_capture" }).catch(() => {});
    bridge.kill();
    bridgesByUdid.delete(udid);
  }

  appState.simulators.delete(udid);
  captureRefsByUdid.delete(udid);
  cancelPendingTeardown(udid);
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
  if (!appState.simulators.has(udid)) {
    throw "No active simulator session";
  }

  const bridge = bridgesByUdid.get(udid);
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
 * Send a named button press (e.g. "home", "menu") to the simulator with the
 * given UDID.
 *
 * The bridge maps button names to macOS virtual keycodes and issues a
 * down+up pair.
 *
 * @throws string if there is no active session for this UDID, or the bridge
 *   returns an error.
 */
export async function simulatorButton(
  udid: string,
  button: string,
): Promise<void> {
  if (!appState.simulators.has(udid)) {
    throw "No active simulator session";
  }

  // iOS hardware buttons go through the in-guest helper: the bridge's Indigo
  // button messages send without error but never reach the device.
  const consumerUsage = HID_CONSUMER_USAGE[button];
  if (consumerUsage !== undefined) {
    return sendButtonUsage(udid, HID_PAGE_CONSUMER, consumerUsage);
  }

  const bridge = bridgesByUdid.get(udid);
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
 * keycode with no name mapping and no automatic down+up pairing. Modifiers are
 * sent as their own key events by the caller, so `modifierFlags` is unused.
 *
 * @throws string if there is no active session, or the helper returns an error.
 */
export async function simulatorKeyboard(
  udid: string,
  keyCode: number,
  modifierFlags: number,
  isDown: boolean,
): Promise<void> {
  if (!appState.simulators.has(udid)) {
    throw "No active simulator session";
  }

  const usage = hidUsageForKeyCode(keyCode);
  if (usage === null) {
    throw `Keyboard failed: no HID usage for key code ${String(keyCode)}`;
  }

  // Modifiers are plain key presses to the guest: hold them around the key so
  // chords land, pressing before the key down and releasing after the key up.
  const modifiers = modifierUsages(modifierFlags);
  for (const modifier of isDown ? modifiers : []) {
    await sendKeyUsage(udid, HID_PAGE_KEYBOARD, modifier, true);
  }
  await sendKeyUsage(udid, HID_PAGE_KEYBOARD, usage, isDown);
  for (const modifier of isDown ? [] : modifiers) {
    await sendKeyUsage(udid, HID_PAGE_KEYBOARD, modifier, false);
  }
}

/**
 * Ask the bridge which panel it is capturing and how its contents are rotated.
 * Null when nothing is being captured for this UDID.
 */
async function readDisplayInfo(udid: string): Promise<DisplayInfo | null> {
  const bridge = bridgesByUdid.get(udid);
  if (!bridge) {
    return null;
  }
  try {
    const res = await bridge.sendCommand({ cmd: "display_info" });
    if (!res.ok) {
      return null;
    }

    return {
      width: res.width as number,
      height: res.height as number,
      screenID: res.screenID as number,
      rotation: rotationForUiOrientation(res.uiOrientation as number),
    };
  } catch {
    return null;
  }
}

/** Fold, orientation and captured-panel geometry for a simulator. */
export async function simulatorDeviceState(
  udid: string,
): Promise<SimulatorDeviceState> {
  return getSimulatorDeviceState(udid, await readDisplayInfo(udid));
}

/**
 * Watch a captured device. The hinge and orientation can be moved from Device
 * Hub or an agent's conductor call as easily as from Argus, so the view can
 * only stay truthful by re-reading rather than trusting its own last write.
 */
const POLL_MS = 2000;
const pollersByUdid = new Map<string, NodeJS.Timeout>();

function startDeviceStatePolling(udid: string): void {
  if (pollersByUdid.has(udid)) {
    return;
  }
  const tick = () => {
    simulatorDeviceState(udid)
      .then(publishSimulatorDeviceState)
      .catch((e) => warn(`[Simulator] device state poll failed:`, e));
  };
  const timer = setInterval(tick, POLL_MS);
  timer.unref?.();
  pollersByUdid.set(udid, timer);
  tick();
}

function stopDeviceStatePolling(udid: string): void {
  const timer = pollersByUdid.get(udid);
  if (timer) {
    clearInterval(timer);
    pollersByUdid.delete(udid);
  }
}

/**
 * Move the hinge, then tell the bridge to re-pick the live panel. Folding
 * swaps which display the system lights, and waiting for the capture to notice
 * on its own leaves the view on a panel that just went dark.
 */
export async function simulatorSetFold(
  udid: string,
  pose: FoldPose | number,
): Promise<SimulatorDeviceState> {
  await setSimulatorFold(udid, pose);
  await bridgesByUdid.get(udid)?.sendCommand({ cmd: "refresh_display" });
  const state = await simulatorDeviceState(udid);
  publishSimulatorDeviceState(state);

  return state;
}

/** Rotate the device and publish the new orientation. */
export async function simulatorSetOrientation(
  udid: string,
  orientation: DeviceOrientation,
): Promise<SimulatorDeviceState> {
  await setSimulatorOrientation(udid, orientation);
  const state = await simulatorDeviceState(udid);
  publishSimulatorDeviceState(state);

  return state;
}
