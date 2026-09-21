/**
 * Huddle orchestration: the store plus the public URL a room needs to be
 * reachable. Kept out of `huddle.ts` so the store stays a leaf — this is the
 * only module that knows a room costs a tunnel lease.
 *
 * Every room takes exactly one `acquirePublicUrl()` lease and gives it back
 * when it ends, however it ends (by hand, at expiry, or on shutdown).
 */

import type { HuddleRoom } from "@argus/remote-protocol";
import { setClaimChangedListener } from "./deviceClaims";
import {
  approveGuest,
  createRoom,
  denyGuest,
  endAllRooms,
  endRoom,
  getRoom,
  listRooms,
  refreshDriving,
  removeGuest,
  setRoomDevice,
  setRoomEndedListener,
  setRoomUrl,
} from "./huddle";
import { acquirePublicUrl, releasePublicUrl } from "./remoteService";

export { approveGuest, denyGuest, getRoom, listRooms, removeGuest };

/**
 * Re-point a live room at whatever device the host now has open. Guests mirror
 * the engineer's runtime rather than a snapshot taken when the link was minted,
 * so starting a simulator mid-huddle hands it to everyone in the room.
 */
export function setHuddleDevice(roomId: string, deviceKey: string): boolean {
  return setRoomDevice(roomId, deviceKey);
}

/**
 * One release per ended room, whichever way it ended. A single-slot setter, so
 * re-registering on every share is idempotent.
 */
function releaseOnEnd(): void {
  setRoomEndedListener(() => releasePublicUrl());
  // Single-slot too, so re-registering on every share stays idempotent.
  setClaimChangedListener((deviceId) => refreshDriving(deviceId));
}

export interface StartHuddleOpts {
  agent_id: string;
  /** Whatever device the host has open; empty when there is none. */
  device_key: string;
  ttl_ms?: number;
}

/**
 * Share an agent: raise (or reuse) a public URL, then open a room on it. The
 * room only exists once the URL does, so a failed tunnel leaves no dangling
 * link for the engineer to paste.
 */
export async function startHuddle(opts: StartHuddleOpts): Promise<HuddleRoom> {
  releaseOnEnd();
  const lease = await acquirePublicUrl();
  let room: HuddleRoom;
  try {
    room = createRoom(opts);
  } catch (err) {
    releasePublicUrl();
    throw err;
  }
  const url = `${lease.webUrl}/#/huddle/${room.token}`;
  setRoomUrl(room.id, url);

  return { ...room, url };
}

/** End one huddle: guests revoked and dropped, the URL lease given back. */
export function stopHuddle(roomId: string): boolean {
  return endRoom(roomId);
}

/** Shutdown / kill-switch: no room, and no lease, outlives the gateway. */
export function stopAllHuddles(): void {
  endAllRooms();
}
