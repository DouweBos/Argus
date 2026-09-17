/**
 * Huddle orchestration: the store plus the public URL a room needs to be
 * reachable. Kept out of `huddle.ts` so the store stays a leaf — this is the
 * only module that knows a room costs a tunnel lease.
 *
 * Every room takes exactly one `acquirePublicUrl()` lease and gives it back
 * when it ends, however it ends (by hand, at expiry, or on shutdown).
 */

import type { HuddleRoom } from "@argus/remote-protocol";
import {
  approveGuest,
  createRoom,
  denyGuest,
  endAllRooms,
  endRoom,
  getRoom,
  listRooms,
  setRoomEndedListener,
  setRoomUrl,
} from "./huddle";
import { acquirePublicUrl, releasePublicUrl } from "./remoteService";

export { approveGuest, denyGuest, getRoom, listRooms };

let listening = false;

/** One release per ended room, whichever way it ended. */
function ensureReleaseOnEnd(): void {
  if (listening) {
    return;
  }
  listening = true;
  setRoomEndedListener(() => releasePublicUrl());
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
  ensureReleaseOnEnd();
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
