/**
 * Device registry — aggregates the current iOS simulators, Android devices,
 * and reserved web browsers into a single list with links to the owning
 * agent / session / project.
 */

import type { SimulatorProblem } from "../simulator/simctlProblems";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { appState } from "../../state";
import { webBrowserPool } from "../browser/pool";
import {
  disconnectAndroidDevice,
  listAndroidDevices,
} from "../simulator/android";
import { resolveDeviceSource } from "../simulator/deviceSources";
import { disconnectSimulator, listAllSimulators } from "../simulator/ios";

const execFileAsync = promisify(execFile);

export type DevicePlatform = "android" | "ios" | "web";

export interface DeviceInfo {
  /** Stable key used for conductor log bucketing: UDID, serial, or browser deviceId. */
  deviceKey: string;
  /** Label of the device host it runs on; absent for this machine. */
  deviceHostLabel?: string;
  platform: DevicePlatform;
  name: string;
  /** iOS runtime string (e.g. "iOS 18.0"). Empty for other platforms. */
  runtime?: string;
  /** True if the device is booted/online. */
  online: boolean;
  /** iOS only: why the simulator can't boot as it is. */
  problem?: SimulatorProblem;
  /** True if the device is currently reserved by an agent. */
  reserved: boolean;
  /** Agent that owns this device, if any. */
  agentId: string | null;
  /** Session the owning agent belongs to (derived via `appState.agents`). */
  sessionId: string | null;
  /** Absolute path of the owning session. Used by the UI to match against
   * the frontend's session store (whose ids may differ from the backend's
   * after a merge). */
  sessionPath: string | null;
  /** Repo root of the owning session. */
  repoRoot: string | null;
  /**
   * Key used when talking to pool/stream APIs for this device.
   * - iOS: UDID
   * - Android: serial
   * - Web: the map key of `webBrowserReservations` (equals whichever
   *   identifier was passed to `acquireBrowser` — agent id or session id).
   */
  reservationKey: string;
}

function resolveAgentOwner(agentId: string | null): {
  sessionId: string | null;
  sessionPath: string | null;
  repoRoot: string | null;
} {
  if (!agentId) {
    return { sessionId: null, sessionPath: null, repoRoot: null };
  }
  const agent = appState.agents.get(agentId);
  if (!agent) {
    return { sessionId: null, sessionPath: null, repoRoot: null };
  }
  const ws = appState.sessions.get(agent.sessionId);

  return {
    sessionId: agent.sessionId,
    sessionPath: ws?.path ?? null,
    repoRoot: ws?.repo_root ?? null,
  };
}

export async function listDevices(): Promise<DeviceInfo[]> {
  const out: DeviceInfo[] = [];

  // Reservation lookup: udid -> agentId
  const simReservationByUdid = new Map<string, string>();
  for (const r of appState.simulatorReservations.values()) {
    simReservationByUdid.set(r.udid, r.agentId);
  }

  // iOS simulators
  try {
    const sims = await listAllSimulators();
    for (const d of sims) {
      const agentId = simReservationByUdid.get(d.udid) ?? null;
      const owner = resolveAgentOwner(agentId);
      out.push({
        deviceKey: d.udid,
        ...(d.deviceHostLabel ? { deviceHostLabel: d.deviceHostLabel } : {}),
        platform: "ios",
        name: d.name,
        runtime: d.runtime,
        online: d.booted,
        ...(d.problem ? { problem: d.problem } : {}),
        reserved: agentId !== null,
        agentId,
        sessionId: owner.sessionId,
        sessionPath: owner.sessionPath,
        repoRoot: owner.repoRoot,
        reservationKey: d.udid,
      });
    }
  } catch {
    // xcrun not available — skip
  }

  // Android devices
  try {
    const droids = await listAndroidDevices();
    for (const d of droids) {
      out.push({
        deviceKey: d.serial,
        platform: "android",
        name: d.name,
        online: d.online,
        reserved: false,
        agentId: null,
        sessionId: null,
        sessionPath: null,
        repoRoot: null,
        reservationKey: d.serial,
      });
    }
  } catch {
    // adb not available — skip
  }

  // Web browser reservations
  for (const [key, r] of appState.webBrowserReservations.entries()) {
    const owner = resolveAgentOwner(r.agentId);
    out.push({
      deviceKey: r.deviceId,
      platform: "web",
      name: r.deviceId,
      online: true,
      reserved: true,
      agentId: r.agentId,
      sessionId: owner.sessionId,
      sessionPath: owner.sessionPath,
      repoRoot: owner.repoRoot,
      reservationKey: key,
    });
  }

  return out;
}

/**
 * Stop (shutdown / kill) a running device.
 *
 * - iOS: shut it down through its device source, then clear any capture state.
 * - Android: `adb -s <serial> emu kill` (emulators only; no-op for physical).
 * - Web: release the browser reservation by its pool key.
 */
export async function stopDevice(
  platform: DevicePlatform,
  deviceKey: string,
): Promise<void> {
  if (platform === "ios") {
    await resolveDeviceSource(deviceKey).close(deviceKey);
    disconnectSimulator(deviceKey);

    return;
  }

  if (platform === "android") {
    try {
      await execFileAsync("adb", ["-s", deviceKey, "emu", "kill"]);
    } catch (e) {
      throw `Failed to stop Android device: ${String(e)}`;
    }
    disconnectAndroidDevice(deviceKey);

    return;
  }

  if (platform === "web") {
    // `deviceKey` here is the conductor deviceId; reservations are keyed by
    // agent/session id, so look up the reservation by matching deviceId.
    for (const [key, r] of appState.webBrowserReservations.entries()) {
      if (r.deviceId === deviceKey) {
        await webBrowserPool.releaseBrowser(key);

        return;
      }
    }
  }
}
