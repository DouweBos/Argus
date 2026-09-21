/**
 * Fold (hinge) and orientation state for iOS simulators.
 *
 * Both are read and driven through conductor, which already solves the hard
 * parts: Apple ships no fold setter, so conductor injects a relay into the
 * simulator's locationd, and foldables ignore `devicectl`'s orientation setter
 * so it drives that through the same relay.
 *
 * Argus needs the state as well as the controls, because the runtime view has
 * to present the stream the way the device is actually being held — a folded
 * Duo lights a different panel, and a rotated device renders sideways into a
 * panel-native framebuffer.
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { emitHostEvent } from "@argus/host/bus";
import { getConductorBinPath } from "../cli/conductor";

const execFileAsync = promisify(execFile);

/** Named hinge poses, matching conductor's vocabulary. */
export type FoldPose = "book" | "closed" | "open" | "partial";

/** Orientations conductor accepts for iOS. */
export type DeviceOrientation =
  | "landscapeLeft"
  | "landscapeRight"
  | "portrait"
  | "portraitUpsideDown";

export interface FoldState {
  /** Hinge angle in degrees: 0 is shut, 180 is flat open. */
  angle: number;
  pose: FoldPose;
}

/** The panel currently being captured, and how its contents are rotated. */
export interface DisplayInfo {
  /** Framebuffer height in pixels, before rotation. */
  height: number;
  /** Clockwise degrees the view must rotate the stream by to sit upright. */
  rotation: 0 | 90 | 180 | 270;
  /** CoreSimulator screen ID — changes when a fold lights the other panel. */
  screenID: number;
  /** Framebuffer width in pixels, before rotation. */
  width: number;
}

export interface SimulatorDeviceState {
  /** Null while nothing is being captured. */
  display: DisplayInfo | null;
  /** Null on devices with no hinge, which is every simulator but the Duo. */
  fold: FoldState | null;
  orientation: DeviceOrientation;
  udid: string;
}

/**
 * Map CoreSimulator's `uiOrientation` to the clockwise rotation the view has to
 * apply. The framebuffer is always panel-native, so a rotated UI is rendered
 * rotated into it and arrives that way in the stream.
 *
 * Calibrated by sweeping every orientation against captured frames; the values
 * are not UIInterfaceOrientation's, which number portrait first.
 */
export function rotationForUiOrientation(
  uiOrientation: number,
): 0 | 90 | 180 | 270 {
  switch (uiOrientation) {
    case 2:
      return 180;
    case 3:
      return 90;
    case 4:
      return 270;
    default:
      return 0;
  }
}

/** Orientations that present the panel rotated a quarter turn. */
const LANDSCAPE: ReadonlySet<string> = new Set([
  "landscapeLeft",
  "landscapeRight",
]);

/** True when this orientation presents the device on its side. */
export function isLandscape(orientation: DeviceOrientation): boolean {
  return LANDSCAPE.has(orientation);
}

async function conductor(args: string[]): Promise<unknown> {
  const { stdout } = await execFileAsync(getConductorBinPath(), [
    ...args,
    "--json",
  ]);
  const line = stdout
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.startsWith("{"))
    .pop();

  return line ? JSON.parse(line) : null;
}

/**
 * Read the hinge, or null when the device has none. conductor reports the
 * angle via devicectl, which errors out on non-foldables — that is the only
 * way to tell a Duo from an iPhone, so the failure is expected and quiet.
 */
async function readFold(udid: string): Promise<FoldState | null> {
  try {
    const res = (await conductor(["get-fold", "--device", udid])) as {
      angle?: number;
      pose?: FoldPose;
    } | null;
    if (!res || typeof res.angle !== "number") {
      return null;
    }

    return { angle: res.angle, pose: res.pose ?? "partial" };
  } catch {
    return null;
  }
}

async function readOrientation(udid: string): Promise<DeviceOrientation> {
  try {
    const res = (await conductor(["get-orientation", "--device", udid])) as {
      orientation?: DeviceOrientation;
    } | null;

    return res?.orientation ?? "portrait";
  } catch {
    return "portrait";
  }
}

/** Current fold + orientation for a simulator. */
export async function getSimulatorDeviceState(
  udid: string,
  display: DisplayInfo | null = null,
): Promise<SimulatorDeviceState> {
  const [fold, orientation] = await Promise.all([
    readFold(udid),
    readOrientation(udid),
  ]);

  return { udid, fold, orientation, display };
}

const lastStateByUdid = new Map<string, string>();

/**
 * Emit `simulator_device_state` when anything moved. The caller supplies the
 * state because only it can read the capture's display info.
 */
export function publishSimulatorDeviceState(state: SimulatorDeviceState): void {
  const key = JSON.stringify(state);
  if (lastStateByUdid.get(state.udid) !== key) {
    lastStateByUdid.set(state.udid, key);
    emitHostEvent("simulator_device_state", state);
  }
}

/** Forget cached state so the next publish always emits. */
export function forgetSimulatorDeviceState(udid: string): void {
  lastStateByUdid.delete(udid);
}

/**
 * Move the hinge. Conductor injects its relay on first use, and that injection
 * restarts locationd, which resets the hinge — so the first call after a cold
 * start lands on 0° whatever was asked for. Re-applying once settles it.
 */
export async function setSimulatorFold(
  udid: string,
  pose: FoldPose | number,
): Promise<SimulatorDeviceState> {
  const value = String(pose);
  await conductor(["set-fold", value, "--device", udid]);

  let state = await getSimulatorDeviceState(udid);
  if (state.fold && state.fold.pose !== pose && typeof pose === "string") {
    await conductor(["set-fold", value, "--device", udid]);
    state = await getSimulatorDeviceState(udid);
  }

  return state;
}

/** Rotate the device. */
export async function setSimulatorOrientation(
  udid: string,
  orientation: DeviceOrientation,
): Promise<SimulatorDeviceState> {
  try {
    await conductor(["set-orientation", orientation, "--device", udid]);
  } catch (e) {
    throw `Rotate failed: ${String(e)}`;
  }

  return getSimulatorDeviceState(udid);
}
