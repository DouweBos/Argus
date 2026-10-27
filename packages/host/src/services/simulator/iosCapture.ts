/**
 * Capture sessions for iOS devices, whatever source they come from: reference
 * counted per device, torn down after a grace period, and watched for fold and
 * orientation for as long as they run.
 */

import type { DeviceSession } from "./deviceSource";
import { warn } from "@argus/host/logger";
import { hostPlatform } from "@argus/host/platform";
import { appState } from "../../state";
import {
  deviceCapabilities,
  deviceSourceIdOf,
  onDeviceSourceGone,
  requireCapability,
  resolveDeviceSource,
} from "./deviceSources";
import {
  type DeviceOrientation,
  type FoldPose,
  type SimulatorDeviceState,
  forgetSimulatorDeviceState,
  getSimulatorDeviceState,
  publishSimulatorDeviceState,
  setSimulatorFold,
  setSimulatorOrientation,
} from "./deviceState";
import { startIosVideoStream, stopIosVideoStream } from "./ios-video";

/**
 * Per-device capture sessions. Each runs independently (for the bridge, its own
 * process and stream port), so N simulators can be streamed concurrently.
 */
const sessionsByUdid = new Map<string, DeviceSession>();

/**
 * Per-UDID reference counts — the main window's runtime view plus any popout
 * windows each hold one ref. The session for a UDID is torn down only when
 * its count hits zero, so closing one popout doesn't kill streams for other
 * devices.
 */
const captureRefsByUdid = new Map<string, number>();

/**
 * In-flight capture starts, keyed by UDID. Guards the non-atomic
 * check-then-start in {@link startSimulatorCapture} so concurrent starts for
 * the same device share one session instead of racing to start duplicates.
 */
const startInFlightByUdid = new Map<string, Promise<number>>();

/**
 * Per-UDID deferred-teardown timers. When the last view holding a capture
 * unmounts, refs hit zero and we *schedule* a tear-down instead of running
 * it immediately — so a quick close/reopen reuses the existing session.
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

/** The session capturing this device, or null if none is running. */
export function captureSessionFor(udid: string): DeviceSession | null {
  return sessionsByUdid.get(udid) ?? null;
}

/** Whether a capture session is currently active for this UDID. */
export function isSimulatorCapturing(udid: string): boolean {
  return (captureRefsByUdid.get(udid) ?? 0) > 0;
}

/**
 * Acquire a capture session for the given UDID and return its handle.
 *
 * If a session is already active for this UDID, just increments its ref
 * count and returns the existing handle. Otherwise starts a new session
 * dedicated to this UDID — other simulators keep streaming unaffected.
 */
export async function startSimulatorCapture(udid: string): Promise<number> {
  // A previous holder dropped to zero refs but the grace timer hasn't fired
  // yet — reclaim the session instead of letting it be torn down.
  cancelPendingTeardown(udid);

  // Fast path: reuse existing capture for the same device.
  const existing = appState.simulators.get(udid);
  const existingSession = sessionsByUdid.get(udid);
  if (existingSession && !existingSession.isAlive()) {
    // The session died under us (a device host's SSH dropped): start over.
    forceStopSimulatorCapture(udid);
  } else if (existing?.mjpegPort != null && existingSession) {
    captureRefsByUdid.set(udid, (captureRefsByUdid.get(udid) ?? 0) + 1);

    return existing.mjpegPort;
  }

  // A start is already in flight for this UDID — the check-then-start above is
  // not atomic across the awaits below, so two near-simultaneous starts (the
  // desktop view opening + a remote watch, or a StrictMode double-invoke) would
  // otherwise each start a session and clobber the registry. Join the in-flight
  // start and just add our own reference once it completes.
  const inflight = startInFlightByUdid.get(udid);
  if (inflight) {
    const port = await inflight;
    captureRefsByUdid.set(udid, (captureRefsByUdid.get(udid) ?? 0) + 1);

    return port;
  }

  const start = beginCapture(udid);
  startInFlightByUdid.set(udid, start);
  try {
    return await start;
  } finally {
    startInFlightByUdid.delete(udid);
  }
}

/** Actually boot + start the session. Serialized per UDID by the in-flight
 *  guard in {@link startSimulatorCapture}; sets the ref count to 1. */
async function beginCapture(udid: string): Promise<number> {
  const source = resolveDeviceSource(udid);
  // Resolve the human-readable device name for the session record
  const device = await source.find(udid);
  if (!device) {
    throw `No simulator found with UDID ${udid}`;
  }

  // Up to Xcode 25 activating Simulator.app booted the device as a side effect;
  // with the Device Hub there is nothing to activate, so boot it explicitly or
  // capture just waits forever on a framebuffer a shut-down device never has.
  if (!device.booted) {
    await source.open(udid);
  } else {
    source.show?.(udid);
  }

  // Registered before it starts, so a teardown racing the start stops it.
  const session = source.session(udid);
  sessionsByUdid.set(udid, session);
  let port: number;
  try {
    port = await session.start();
  } catch (err) {
    sessionsByUdid.delete(udid);
    throw err;
  }

  // Forward the device's stream to the renderer's WebCodecs decoder.
  startIosVideoStream(udid, session.video);

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
 * was the last holder, schedule a deferred teardown — the session stays
 * alive for {@link TEARDOWN_GRACE_MS} so a re-mounting view (route change,
 * dialog reopen) can reclaim it without restarting it. If no view comes back
 * within the grace period, the session is force-stopped.
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
  stopDeviceStatePolling(udid);
  forgetSimulatorDeviceState(udid);

  const session = sessionsByUdid.get(udid);
  if (session) {
    session.stop();
    sessionsByUdid.delete(udid);
  }

  appState.simulators.delete(udid);
  captureRefsByUdid.delete(udid);
  cancelPendingTeardown(udid);
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

/** Fold, orientation and captured-panel geometry for a simulator. */
export async function simulatorDeviceState(
  udid: string,
): Promise<SimulatorDeviceState> {
  const display = (await sessionsByUdid.get(udid)?.displayInfo()) ?? null;
  const caps = deviceCapabilities(udid);
  if (!caps.rotation && !caps.fold) {
    return { udid, fold: null, orientation: "portrait", display };
  }

  return getSimulatorDeviceState(udid, display);
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
 * Move the hinge, then have the session re-pick the live panel. Folding swaps
 * which display the system lights, and waiting for the capture to notice on
 * its own leaves the view on a panel that just went dark.
 */
export async function simulatorSetFold(
  udid: string,
  pose: FoldPose | number,
): Promise<SimulatorDeviceState> {
  requireCapability(udid, "fold");
  await setSimulatorFold(udid, pose);
  await sessionsByUdid.get(udid)?.refreshDisplay();
  const state = await simulatorDeviceState(udid);
  publishSimulatorDeviceState(state);

  return state;
}

/** Rotate the device and publish the new orientation. */
export async function simulatorSetOrientation(
  udid: string,
  orientation: DeviceOrientation,
): Promise<SimulatorDeviceState> {
  requireCapability(udid, "rotation");
  await setSimulatorOrientation(udid, orientation);
  const state = await simulatorDeviceState(udid);
  publishSimulatorDeviceState(state);

  return state;
}

// A source going away (a device host removed) stops its captures; its
// simulators keep running.
onDeviceSourceGone((sourceId) => {
  for (const id of [...sessionsByUdid.keys(), ...appState.simulators.keys()]) {
    if (deviceSourceIdOf(id) === sourceId) {
      forceStopSimulatorCapture(id);
    }
  }
});
