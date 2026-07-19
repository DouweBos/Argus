/**
 * Android device control.
 *
 * Uses adb CLI for device/emulator management and AndroidBridge for
 * screen capture (via scrcpy-server) and input injection.
 */

import type { AndroidCaptureBackend } from "./android-backend";
import { execFile, spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import * as net from "node:net";
import path from "node:path";
import { promisify } from "node:util";
import { error, log } from "../../../app/lib/logger";
import { appState } from "../../state";
import { AndroidBridge } from "./android-bridge";
import { EmulatorGrpcBridge } from "./emulator-grpc-bridge";

/** The active capture backend (emulator gRPC or scrcpy), if any. */
let activeBackend: AndroidCaptureBackend | null = null;

const execFileAsync = promisify(execFile);

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface AndroidDevice {
  /** AVD name (only for emulators — used to boot). Null for physical devices. */
  avdName: string | null;
  name: string;
  online: boolean;
  serial: string;
  type: "emulator" | "physical";
}

// ---------------------------------------------------------------------------
// Binary resolution
// ---------------------------------------------------------------------------

/**
 * Resolve the path to an Android SDK binary.
 *
 * Checks `$ANDROID_HOME/{subdir}/{binary}` first, then falls back to PATH
 * lookup via `which`.
 */
async function findAndroidBinary(
  binary: string,
  subdir: string,
): Promise<string> {
  const androidHome = process.env.ANDROID_HOME ?? process.env.ANDROID_SDK_ROOT;
  if (androidHome) {
    const candidate = path.join(androidHome, subdir, binary);
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  // Fall back to PATH
  try {
    const { stdout } = await execFileAsync("which", [binary]);
    const resolved = stdout.trim();
    if (resolved) {
      return resolved;
    }
  } catch {
    // not found
  }

  throw `Could not find '${binary}'. Ensure Android SDK is installed and ANDROID_HOME is set, or add ${binary} to your PATH.`;
}

/** Cached adb path. */
let cachedAdbPath: string | null = null;

export async function findAdb(): Promise<string> {
  if (cachedAdbPath) {
    return cachedAdbPath;
  }
  cachedAdbPath = await findAndroidBinary("adb", "platform-tools");

  return cachedAdbPath;
}

/** Cached emulator path. */
let cachedEmulatorPath: string | null = null;

async function findEmulator(): Promise<string> {
  if (cachedEmulatorPath) {
    return cachedEmulatorPath;
  }
  cachedEmulatorPath = await findAndroidBinary("emulator", "emulator");

  return cachedEmulatorPath;
}

// ---------------------------------------------------------------------------
// Tool availability check
// ---------------------------------------------------------------------------

/**
 * Check whether Android SDK tools (adb) are available.
 *
 * Resolves on success, throws a user-facing message on failure.
 */
export async function checkAndroidTools(): Promise<void> {
  try {
    await findAdb();
  } catch {
    throw "Android SDK not found. Install Android Studio and ensure ANDROID_HOME is set, or add adb to your PATH.";
  }
}

// ---------------------------------------------------------------------------
// Device management
// ---------------------------------------------------------------------------

/**
 * List Android devices: connected devices/emulators from `adb devices` plus
 * unbooted AVDs from `emulator -list-avds`.
 *
 * This mirrors the iOS side where both booted and unbooted simulators appear
 * in the picker.
 */
export async function listAndroidDevices(): Promise<AndroidDevice[]> {
  // Run adb and AVD listing in parallel
  const [adbDevices, avdNames] = await Promise.all([
    listAdbDevices(),
    listAvds(),
  ]);

  // Build a set of AVD names that are already running so we don't duplicate
  const runningAvds = new Set<string>();
  for (const d of adbDevices) {
    if (d.avdName) {
      runningAvds.add(d.avdName);
    }
  }

  // Add unbooted AVDs
  const devices: AndroidDevice[] = [...adbDevices];
  for (const avd of avdNames) {
    if (!runningAvds.has(avd)) {
      devices.push({
        avdName: avd,
        name: avd.replace(/[_.]/g, " "),
        online: false,
        serial: `avd:${avd}`,
        type: "emulator",
      });
    }
  }

  // Sort: online first, then alphabetically
  devices.sort((a, b) => {
    if (a.online !== b.online) {
      return a.online ? -1 : 1;
    }

    return a.name.localeCompare(b.name);
  });

  return devices;
}

/**
 * List connected devices from `adb devices -l`.
 *
 * For running emulators, resolves the AVD name via `adb -s SERIAL emu avd name`.
 */
async function listAdbDevices(): Promise<AndroidDevice[]> {
  let adbPath: string;
  try {
    adbPath = await findAdb();
  } catch {
    return [];
  }

  let stdout: string;
  try {
    ({ stdout } = await execFileAsync(adbPath, ["devices", "-l"]));
  } catch {
    return [];
  }

  const devices: AndroidDevice[] = [];
  const lines = stdout.split("\n");

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("List of") || trimmed.startsWith("*")) {
      continue;
    }

    const parts = trimmed.split(/\s+/);
    if (parts.length < 2) {
      continue;
    }

    const serial = parts[0];
    const state = parts[1];
    const online = state === "device";

    let name = serial;
    for (const part of parts.slice(2)) {
      if (part.startsWith("model:")) {
        name = part.slice(6).replace(/_/g, " ");
      }
    }

    const isEmulator =
      serial.startsWith("emulator-") || serial.startsWith("localhost:");

    devices.push({
      avdName: null,
      name,
      online,
      serial,
      type: isEmulator ? "emulator" : "physical",
    });
  }

  // Resolve AVD names for running emulators (in parallel)
  await Promise.all(
    devices
      .filter((d) => d.type === "emulator" && d.online)
      .map(async (d) => {
        try {
          const adb = await findAdb();
          const { stdout: avdOut } = await execFileAsync(adb, [
            "-s",
            d.serial,
            "emu",
            "avd",
            "name",
          ]);
          const avdName = avdOut.split("\n")[0].trim();
          if (avdName && avdName !== "OK") {
            d.avdName = avdName;
            d.name = avdName.replace(/[_.]/g, " ");
          }
        } catch {
          // Could not resolve AVD name — keep serial-based name
        }
      }),
  );

  return devices;
}

/**
 * List available Android Virtual Devices (AVDs).
 *
 * Returns AVD names that can be booted with `bootAndroidEmulator()`.
 */
export async function listAvds(): Promise<string[]> {
  let emulatorPath: string;
  try {
    emulatorPath = await findEmulator();
  } catch {
    return [];
  }

  try {
    const { stdout } = await execFileAsync(emulatorPath, ["-list-avds"]);

    return stdout
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l.length > 0);
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// Emulator boot
// ---------------------------------------------------------------------------

/** Long-lived emulator process reference (we don't wait for it to exit). */
let emulatorProc: ChildProcess | null = null;

/**
 * Boot an Android emulator by AVD name.
 *
 * Returns the emulator serial (e.g. "emulator-5554") once the device
 * appears as "online" in `adb devices`.
 *
 * Note: we intentionally do NOT use `-no-window`. Newer emulators (API 34+)
 * often fail to fully initialize headless — the device stays "offline" in
 * adb because the graphics subsystem never starts. The emulator window can
 * be minimised; Argus provides the mirror.
 *
 * We pass `-grpc <port>` so the emulator exposes a plain (insecure) gRPC
 * endpoint for the EmulatorGrpcBridge. Without it, modern emulators default to
 * TLS+JWT-secured gRPC, which the bridge can't reach (it then falls back to
 * scrcpy).
 */
export async function bootAndroidEmulator(avdName: string): Promise<string> {
  const emulatorPath = await findEmulator();

  // Snapshot currently online emulators so we can detect the new one
  const before = await listAdbDevices();
  const onlineBefore = new Set(
    before.filter((d) => d.online).map((d) => d.serial),
  );

  const grpcPort = await findFreePort();
  emulatorProc = spawn(
    emulatorPath,
    [
      "-avd",
      avdName,
      "-no-audio",
      "-no-boot-anim",
      "-no-snapshot-load",
      "-grpc",
      String(grpcPort),
    ],
    { stdio: "ignore", detached: true },
  );
  emulatorProc.unref();

  emulatorProc.on("error", (err) => {
    error("[Android] emulator launch error:", err);
  });

  // Poll adb until a new emulator comes online (up to 90s — cold boot is slow)
  const startTime = Date.now();
  const timeout = 90_000;

  while (Date.now() - startTime < timeout) {
    await new Promise((r) => setTimeout(r, 2000));

    const current = await listAdbDevices();
    const newOnline = current.find(
      (d) => d.type === "emulator" && d.online && !onlineBefore.has(d.serial),
    );
    if (newOnline) {
      return newOnline.serial;
    }
  }

  throw "Timed out waiting for emulator to boot (90s)";
}

/** Find a free TCP port for the emulator's gRPC endpoint. */
function findFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.listen(0, "127.0.0.1", () => {
      const port = (srv.address() as net.AddressInfo).port;
      srv.close(() => resolve(port));
    });
    srv.on("error", reject);
  });
}

// ---------------------------------------------------------------------------
// Capture
// ---------------------------------------------------------------------------

/**
 * Start capturing an Android device screen.
 *
 * Emulators use the emulator's native gRPC API (fast startup, low-latency
 * input); physical devices use scrcpy-server. Both emit the same
 * android_video_config / android_video_frame IPC events.
 */
export async function startAndroidCapture(serial: string): Promise<void> {
  const adbPath = await findAdb();

  // Resolve device name
  const devices = await listAndroidDevices();
  const device = devices.find((d) => d.serial === serial);
  if (!device) {
    throw `No Android device found with serial ${serial}`;
  }

  const backend = await startCaptureBackend(device, adbPath);
  activeBackend = backend;
  AndroidBridge.instance = backend instanceof AndroidBridge ? backend : null;

  appState.androidDevice = {
    serial,
    deviceName: device.name,
    type: device.type,
    captureActive: true,
  };
}

/**
 * Pick and start a capture backend. Emulators try gRPC first and fall back to
 * scrcpy if the gRPC endpoint is unreachable; physical devices use scrcpy.
 */
async function startCaptureBackend(
  device: AndroidDevice,
  adbPath: string,
): Promise<AndroidCaptureBackend> {
  if (device.type === "emulator") {
    try {
      const grpc = new EmulatorGrpcBridge({ serial: device.serial, adbPath });
      await grpc.start();
      log(`[Android] using emulator gRPC backend for ${device.serial}`);

      return grpc;
    } catch (err) {
      log(
        `[Android] emulator gRPC unavailable (${String(err)}), falling back to scrcpy`,
      );
    }
  }

  const scrcpy = new AndroidBridge({ serial: device.serial, adbPath });
  await scrcpy.start();

  return scrcpy;
}

/**
 * Stop the active Android capture session.
 */
export function stopAndroidCapture(): void {
  if (activeBackend) {
    activeBackend.kill();
    activeBackend = null;
  }
  AndroidBridge.instance = null;
  appState.androidDevice = null;
}

/**
 * Disconnect a specific Android device.
 */
export function disconnectAndroidDevice(serial: string): void {
  if (appState.androidDevice?.serial === serial) {
    stopAndroidCapture();
  }
}

// ---------------------------------------------------------------------------
// Input injection
// ---------------------------------------------------------------------------

/**
 * Inject a touch event.
 *
 * `x` and `y` are normalized coordinates in [0.0, 1.0].
 * `eventType`: 0 = Down, 1 = Move, 2 = Up.
 */
export function androidTouch(
  serial: string,
  x: number,
  y: number,
  eventType: number,
): void {
  if (!appState.androidDevice || appState.androidDevice.serial !== serial) {
    throw "No active Android capture session";
  }

  if (!activeBackend) {
    throw "Android bridge is not running";
  }

  // Map our event types to Android MotionEvent actions
  const actionMap: Record<number, number> = {
    0: 0, // Down → ACTION_DOWN
    1: 2, // Move → ACTION_MOVE
    2: 1, // Up → ACTION_UP
  };
  const action = actionMap[eventType] ?? 2;
  const pressure = eventType === 2 ? 0 : 1;

  activeBackend.sendTouch(action, x, y, pressure);
}

/**
 * Inject a keyboard event.
 *
 * Uses Android keycodes (AKEYCODE_*), not macOS virtual keycodes.
 */
export function androidKeyboard(
  keyCode: number,
  metaState: number,
  isDown: boolean,
): void {
  if (!appState.androidDevice) {
    throw "No active Android capture session";
  }

  if (!activeBackend) {
    throw "Android bridge is not running";
  }

  activeBackend.sendKey(isDown ? 0 : 1, keyCode, metaState);
}

/**
 * Send a named button press (e.g. "home", "back", "recents").
 *
 * Maps button names to Android keycodes and issues a down + up pair.
 */
export async function androidButton(button: string): Promise<void> {
  if (!appState.androidDevice) {
    throw "No active Android capture session";
  }

  if (!activeBackend) {
    throw "Android bridge is not running";
  }

  await activeBackend.sendButton(button);
}
