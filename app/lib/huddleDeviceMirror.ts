/**
 * Keeps every live huddle pointed at the device its agent's session currently
 * has open.
 *
 * A room's device is not a snapshot taken when the link was minted: guests are
 * watching over the engineer's shoulder, so starting a simulator — or switching
 * platform, or closing one — mid-huddle has to reach them too. The host cannot
 * work this out on its own, because "the device this session has open" is a
 * renderer-side selection, so the mirror lives here and pushes.
 */

import { getAgentState } from "../stores/agentStore";
import { getHuddleState, subscribeHuddleRooms } from "../stores/huddleStore";
import {
  getSimulatorState,
  subscribeSimulator,
} from "../stores/simulatorStore";
import { shareableDeviceKey } from "./huddleDevice";
import { huddleSetDevice } from "./ipc";

/** Rooms we've already pushed, so a re-render doesn't re-send the same key. */
const pushed = new Map<string, string>();

function syncRooms(): void {
  const rooms = getHuddleState().rooms;
  if (rooms.length === 0) {
    pushed.clear();

    return;
  }
  const sim = getSimulatorState();
  const agents = getAgentState().agents;

  for (const room of rooms) {
    const sessionId = agents[room.agent_id]?.session_id;
    if (!sessionId) {
      continue;
    }
    const key = shareableDeviceKey(
      {
        platform: sim.platform,
        iosUdid: sim.selectedUdidBySession[sessionId] ?? null,
        androidSerial: sim.selectedAndroidBySession[sessionId] ?? null,
      },
      sessionId,
    );
    if (key === room.device_key || pushed.get(room.id) === key) {
      continue;
    }
    pushed.set(room.id, key);
    huddleSetDevice(room.id, key).catch(() => pushed.delete(room.id));
  }

  for (const id of [...pushed.keys()]) {
    if (!rooms.some((r) => r.id === id)) {
      pushed.delete(id);
    }
  }
}

/**
 * Watch the runtime selection for the lifetime of the app. Rooms are also
 * re-checked on every `huddle:changed`, which is what carries a brand-new room
 * that opened while a device was already running.
 */
export function initHuddleDeviceMirror(): void {
  subscribeSimulator(syncRooms);
  subscribeHuddleRooms(syncRooms);
  syncRooms();
}
