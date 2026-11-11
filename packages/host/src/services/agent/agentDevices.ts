/**
 * Devices a parent hands to an agent at spawn (`spawn_agent` `devices`), on top
 * of the simulator the pool reserves for it. Held on the agent itself, so they
 * follow it through respawns and free up when it ends.
 */

import type { AttachedDevice } from "./models";
import { appState } from "../../state";
import { listAndroidDevices } from "../simulator/android";
import { listSimulators } from "../simulator/simulatorList";

interface DeviceLister {
  ios: () => Promise<{ udid: string; name: string }[]>;
  android: () => Promise<{ serial: string; name: string }[]>;
}

const localDevices: DeviceLister = {
  ios: listSimulators,
  android: () => listAndroidDevices().catch(() => []),
};

/** Who holds a device: a pool reservation or another live agent's attachment. */
export function deviceHolder(
  id: string,
  exceptAgentId?: string,
): string | null {
  for (const r of appState.simulatorReservations.values()) {
    if (r.udid === id && r.agentId !== exceptAgentId) {
      return r.agentId;
    }
  }
  for (const agent of appState.agents.values()) {
    if (
      agent.agentId !== exceptAgentId &&
      agent.status !== "stopped" &&
      agent.status !== "error" &&
      agent.profile?.devices?.some((d) => d.id === id)
    ) {
      return agent.agentId;
    }
  }

  return null;
}

/** UDIDs live agents hold by attachment; the pool hands none of them out. */
export function attachedUdids(): Set<string> {
  const out = new Set<string>();
  for (const agent of appState.agents.values()) {
    if (agent.status === "stopped" || agent.status === "error") {
      continue;
    }
    for (const d of agent.profile?.devices ?? []) {
      if (d.platform === "ios") {
        out.add(d.id);
      }
    }
  }

  return out;
}

function matchDevice(
  ref: string,
  sims: { udid: string; name: string }[],
  androids: { serial: string; name: string }[],
): AttachedDevice | null {
  const sim = sims.find((s) => s.udid === ref || s.name === ref);
  if (sim) {
    return { platform: "ios", id: sim.udid, name: sim.name };
  }
  const android = androids.find((a) => a.serial === ref || a.name === ref);

  return android
    ? { platform: "android", id: android.serial, name: android.name }
    : null;
}

/**
 * Resolve UDIDs, serials or exact device names to devices on this machine.
 * Throws a string naming the first ref that's unknown or already held.
 */
export async function resolveDeviceRefs(
  refs: string[],
  lister: DeviceLister = localDevices,
): Promise<AttachedDevice[]> {
  if (refs.length === 0) {
    return [];
  }
  const [sims, androids] = await Promise.all([lister.ios(), lister.android()]);
  const out: AttachedDevice[] = [];
  for (const ref of refs) {
    const device = matchDevice(ref, sims, androids);
    if (!device) {
      throw `Unknown device "${ref}": pass a simulator UDID or name, or an Android serial, from \`conductor list-devices\`.`;
    }
    const holder = deviceHolder(device.id);
    if (holder) {
      throw `${device.name} (${device.id}) is already held by agent ${holder}.`;
    }
    if (!out.some((d) => d.id === device.id)) {
      out.push(device);
    }
  }

  return out;
}
