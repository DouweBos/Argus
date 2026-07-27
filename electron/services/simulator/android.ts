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

/** Active capture backends (emulator gRPC or scrcpy), keyed by serial. */
const backends = new Map<string, AndroidCaptureBackend>();

/**
 * Reference counts per serial. Each holder — the desktop grid tile, the
 * runtime panel, a remote watcher — owns one ref. The backend for a serial is
 * torn down only when its count hits zero, so closing one viewer doesn't kill
 * streams other viewers still need. Mirrors the iOS `captureRefsByUdid` model.
 */
const captureRefsBySerial = new Map<string, number>();

/**
 * In-flight capture spawns, keyed by serial. Guards the non-atomic
 * check-then-spawn in {@link startAndroidCapture} so concurrent starts for the
 * same device share one backend instead of racing to spawn duplicates.
 */
const startInFlightBySerial = new Map<string, Promise<void>>();

/**
 * Per-serial deferred-teardown timers. When the last holder releases its ref,
 * we schedule teardown instead of running it immediately so a quick
 * close/reopen reuses the existing backend.
 */
const pendingTeardownBySerial = new Map<
  string,
  ReturnType<typeof setTimeout>
>();

const TEARDOWN_GRACE_MS = 10 * 60 * 1000;

function cancelPendingTeardown(serial: string): void {
  const timer = pendingTeardownBySerial.get(serial);
  if (timer) {
    clearTimeout(timer);
    pendingTeardownBySerial.delete(serial);
  }
}

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
  /** Android TV form factor (Chromecast / leanback) — dpad-driven, not touch. */
  isTv: boolean;
}

/** Cached `ro.build.characteristics` TV check per serial (hardware is static). */
const tvBySerial = new Map<string, boolean>();

/** Resolve (and cache) whether a booted device is an Android TV. */
async function resolveIsTv(serial: string, adbPath: string): Promise<boolean> {
  const cached = tvBySerial.get(serial);
  if (cached !== undefined) {
    return cached;
  }
  let isTv = false;
  try {
    const { stdout } = await execFileAsync(adbPath, [
      "-s",
      serial,
      "shell",
      "getprop",
      "ro.build.characteristics",
    ]);
    isTv = stdout.toLowerCase().includes("tv");
  } catch {
    // Unreachable device — assume not a TV; don't cache so we retry later.
    return false;
  }
  tvBySerial.set(serial, isTv);

  return isTv;
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
        isTv: false,
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
      isTv: false,
    });
  }

  // Resolve AVD names for running emulators + TV form factor (in parallel)
  await Promise.all(
    devices
      .filter((d) => d.online)
      .map(async (d) => {
        d.isTv = await resolveIsTv(d.serial, adbPath);
        if (d.type !== "emulator") {
          return;
        }
        try {
          const { stdout: avdOut } = await execFileAsync(adbPath, [
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
  // A previous holder dropped to zero refs but the grace timer hasn't fired
  // yet — reclaim the backend instead of letting it be torn down.
  cancelPendingTeardown(serial);

  // Fast path: reuse an existing capture, just add a reference.
  if (backends.has(serial)) {
    captureRefsBySerial.set(serial, (captureRefsBySerial.get(serial) ?? 0) + 1);

    return;
  }

  // A spawn is already in flight for this serial — the check above is not
  // atomic across the awaits in spawn, so two near-simultaneous starts (a grid
  // tile mount + a remote watch, or a StrictMode double-invoke) would each
  // spawn a backend and clobber the registry. Join the in-flight spawn.
  const inflight = startInFlightBySerial.get(serial);
  if (inflight) {
    await inflight;
    captureRefsBySerial.set(serial, (captureRefsBySerial.get(serial) ?? 0) + 1);

    return;
  }

  const spawning = spawnAndroidCapture(serial);
  startInFlightBySerial.set(serial, spawning);
  try {
    await spawning;
  } finally {
    startInFlightBySerial.delete(serial);
  }
}

/** Actually spawn the backend + start capture. Serialized per serial by the
 *  in-flight guard in {@link startAndroidCapture}; sets the ref count to 1. */
async function spawnAndroidCapture(serial: string): Promise<void> {
  const adbPath = await findAdb();

  // Resolve device name
  const devices = await listAndroidDevices();
  const device = devices.find((d) => d.serial === serial);
  if (!device) {
    throw `No Android device found with serial ${serial}`;
  }

  const backend = await startCaptureBackend(device, adbPath);
  backends.set(serial, backend);

  appState.androidDevices.set(serial, {
    serial,
    deviceName: device.name,
    type: device.type,
    captureActive: true,
  });
  captureRefsBySerial.set(serial, 1);
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
 * Release one reference to a serial's capture session. If this was the last
 * holder, schedule a deferred teardown — the backend stays alive for {@link
 * TEARDOWN_GRACE_MS} so a re-mounting view (grid toggle, dialog reopen) can
 * reclaim it without respawning. With no serial, force-stops every session
 * immediately (shutdown / global teardown). No-ops if nothing is active.
 */
export function stopAndroidCapture(serial?: string): void {
  if (serial === undefined) {
    for (const s of [...backends.keys()]) {
      forceStopAndroidCapture(s);
    }

    return;
  }

  const refs = captureRefsBySerial.get(serial) ?? 0;
  if (refs > 1) {
    captureRefsBySerial.set(serial, refs - 1);

    return;
  }
  if (refs === 0) {
    return;
  }
  captureRefsBySerial.set(serial, 0);

  cancelPendingTeardown(serial);
  const timer = setTimeout(() => {
    pendingTeardownBySerial.delete(serial);
    forceStopAndroidCapture(serial);
  }, TEARDOWN_GRACE_MS);
  timer.unref?.();
  pendingTeardownBySerial.set(serial, timer);
}

/**
 * Unconditionally stop a serial's capture session, regardless of outstanding
 * references. Used for hard-disconnect flows (Disconnect button, device
 * switch) where the stream should go down immediately.
 */
export function forceStopAndroidCapture(serial: string): void {
  const backend = backends.get(serial);
  if (backend) {
    backend.kill();
    backends.delete(serial);
  }
  appState.androidDevices.delete(serial);
  captureRefsBySerial.delete(serial);
  cancelPendingTeardown(serial);
}

/** Whether a capture session is currently active (optionally for a serial). */
export function isAndroidCapturing(serial?: string): boolean {
  return serial
    ? (captureRefsBySerial.get(serial) ?? 0) > 0
    : backends.size > 0;
}

/**
 * Disconnect a specific Android device — hard teardown, ignoring refs.
 */
export function disconnectAndroidDevice(serial: string): void {
  forceStopAndroidCapture(serial);
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
  const backend = backends.get(serial);
  if (!backend) {
    throw "No active Android capture session";
  }

  // Map our event types to Android MotionEvent actions
  const actionMap: Record<number, number> = {
    0: 0, // Down → ACTION_DOWN
    1: 2, // Move → ACTION_MOVE
    2: 1, // Up → ACTION_UP
  };
  const action = actionMap[eventType] ?? 2;
  const pressure = eventType === 2 ? 0 : 1;

  backend.sendTouch(action, x, y, pressure);
}

/**
 * Inject a keyboard event.
 *
 * Uses Android keycodes (AKEYCODE_*), not macOS virtual keycodes.
 */
export function androidKeyboard(
  serial: string,
  keyCode: number,
  metaState: number,
  isDown: boolean,
): void {
  const backend = backends.get(serial);
  if (!backend) {
    throw "No active Android capture session";
  }

  backend.sendKey(isDown ? 0 : 1, keyCode, metaState);
}

/**
 * Send a named button press (e.g. "home", "back", "recents").
 *
 * Maps button names to Android keycodes and issues a down + up pair.
 */
export async function androidButton(
  serial: string,
  button: string,
): Promise<void> {
  const backend = backends.get(serial);
  if (!backend) {
    throw "No active Android capture session";
  }

  await backend.sendButton(button);
}
