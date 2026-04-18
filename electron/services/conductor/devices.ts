/**
 * Device registry — aggregates the current iOS simulators, Android devices,
 * and reserved web browsers into a single list with links to the owning
 * agent / workspace / project.
 */

import { appState } from "../../state";
import { listAndroidDevices } from "../simulator/android";
import { listSimulators } from "../simulator/ios";

export type DevicePlatform = "android" | "ios" | "web";

export interface DeviceInfo {
  /** Stable key used for conductor log bucketing: UDID, serial, or browser deviceId. */
  deviceKey: string;
  platform: DevicePlatform;
  name: string;
  /** iOS runtime string (e.g. "iOS 18.0"). Empty for other platforms. */
  runtime?: string;
  /** True if the device is booted/online. */
  online: boolean;
  /** True if the device is currently reserved by an agent. */
  reserved: boolean;
  /** Agent that owns this device, if any. */
  agentId: string | null;
  /** Workspace the owning agent belongs to (derived via `appState.agents`). */
  workspaceId: string | null;
  /** Absolute path of the owning workspace. Used by the UI to match against
   * the frontend's workspace store (whose ids may differ from the backend's
   * after a merge). */
  workspacePath: string | null;
  /** Repo root of the owning workspace. */
  repoRoot: string | null;
  /**
   * Key used when talking to pool/stream APIs for this device.
   * - iOS: UDID
   * - Android: serial
   * - Web: the map key of `webBrowserReservations` (equals whichever
   *   identifier was passed to `acquireBrowser` — agent id or workspace id).
   */
  reservationKey: string;
}

function resolveAgentOwner(agentId: string | null): {
  workspaceId: string | null;
  workspacePath: string | null;
  repoRoot: string | null;
} {
  if (!agentId) {
    return { workspaceId: null, workspacePath: null, repoRoot: null };
  }
  const agent = appState.agents.get(agentId);
  if (!agent) {
    return { workspaceId: null, workspacePath: null, repoRoot: null };
  }
  const ws = appState.workspaces.get(agent.workspaceId);

  return {
    workspaceId: agent.workspaceId,
    workspacePath: ws?.path ?? null,
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
    const sims = await listSimulators();
    for (const d of sims) {
      const agentId = simReservationByUdid.get(d.udid) ?? null;
      const owner = resolveAgentOwner(agentId);
      out.push({
        deviceKey: d.udid,
        platform: "ios",
        name: d.name,
        runtime: d.runtime,
        online: d.booted,
        reserved: agentId !== null,
        agentId,
        workspaceId: owner.workspaceId,
        workspacePath: owner.workspacePath,
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
        workspaceId: null,
        workspacePath: null,
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
      workspaceId: owner.workspaceId,
      workspacePath: owner.workspacePath,
      repoRoot: owner.repoRoot,
      reservationKey: key,
    });
  }

  return out;
}
