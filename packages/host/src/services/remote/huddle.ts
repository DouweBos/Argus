/**
 * The huddle room store: who is sharing what, with whom, and for how long.
 *
 * In memory only, on purpose (see `plan/huddle-rooms.md` §7). Nothing here is
 * written to `remote-devices.json` or anywhere else, so a crash or a quit ends
 * every share rather than leaving a live link behind, and a guest's ephemeral
 * key never becomes adopted hardware.
 *
 * Transport-agnostic: a live guest socket is represented by a {@link GuestLink}
 * of callbacks the gateway supplies, so this module knows nothing about Noise,
 * WebSockets or capabilities, and the gateway can call in without a cycle.
 */

import type {
  GrantScope,
  HuddleGuest,
  HuddleRoom,
  HuddleStatePayload,
} from "@argus/remote-protocol";
import { randomUUID, randomBytes, timingSafeEqual } from "node:crypto";
import { emitHostEvent } from "@argus/host/bus";

/** Backstop lifetime for a forgotten share. The engineer normally ends it. */
export const ROOM_TTL_MS = 4 * 60 * 60 * 1000;

/** How often the backstop is checked. Cheap: rooms are a handful at most. */
const SWEEP_INTERVAL_MS = 60_000;

/** A live guest socket, as far as the room store needs to care. */
export interface GuestLink {
  /** Install the scoped grant on the socket (the host approved). */
  grant: (scope: GrantScope) => void;
  /** Strip the grant and drop the socket (denied, revoked, or room ended). */
  revoke: () => void;
  /** Push the guest its current standing. */
  notify: (payload: HuddleStatePayload) => void;
}

interface RoomEntry {
  room: HuddleRoom;
  /** Live sockets by guest key. A guest with no link has closed their tab. */
  links: Map<string, GuestLink>;
}

const rooms = new Map<string, RoomEntry>();
let sweepTimer: ReturnType<typeof setInterval> | null = null;
let roomEnded: (() => void) | null = null;

/**
 * Called once per ended room, whichever way it ended. `huddleService` hangs
 * `releasePublicUrl()` off this so expiry drops the tunnel like a manual end.
 */
export function setRoomEndedListener(cb: (() => void) | null): void {
  roomEnded = cb;
}

function emitChanged(): void {
  emitHostEvent("huddle:changed", { rooms: listRooms() });
}

function scheduleSweep(): void {
  if (sweepTimer || rooms.size === 0) {
    return;
  }
  sweepTimer = setInterval(() => sweepRooms(), SWEEP_INTERVAL_MS);
  sweepTimer.unref?.();
}

function stopSweep(): void {
  if (sweepTimer && rooms.size === 0) {
    clearInterval(sweepTimer);
    sweepTimer = null;
  }
}

function statePayload(
  room: HuddleRoom,
  guest: HuddleGuest | null,
  state: HuddleStatePayload["state"],
): HuddleStatePayload {
  // A guest that is not approved learns nothing about the room beyond its id —
  // not the agent, not the device.
  const approved = state === "approved" && guest?.state === "approved";

  return {
    room_id: room.id,
    state,
    agent_id: approved ? room.agent_id : null,
    device_key: approved && room.device_key ? room.device_key : null,
  };
}

/** What a scoped grant for this room's guests may address. */
export function guestScope(room: HuddleRoom): GrantScope {
  return {
    agent_ids: [room.agent_id],
    // An empty device_key means the host had nothing open: chat-only by
    // circumstance, so the grant names no device at all.
    device_keys: room.device_key ? [room.device_key] : [],
  };
}

export interface CreateRoomOpts {
  agent_id: string;
  /** Whatever device the host has open; empty string when there is none. */
  device_key: string;
  /** Override the backstop lifetime (tests, mostly). */
  ttl_ms?: number;
}

export function createRoom(opts: CreateRoomOpts): HuddleRoom {
  const now = Date.now();
  const room: HuddleRoom = {
    id: randomUUID(),
    token: randomBytes(32).toString("base64url"),
    agent_id: opts.agent_id,
    device_key: opts.device_key,
    url: null,
    created_at: now,
    expires_at: now + (opts.ttl_ms ?? ROOM_TTL_MS),
    guests: [],
  };
  rooms.set(room.id, { room, links: new Map() });
  scheduleSweep();
  emitChanged();

  return room;
}

/** Attach the shareable link once the tunnel has one. */
export function setRoomUrl(roomId: string, url: string | null): void {
  const entry = rooms.get(roomId);
  if (!entry) {
    return;
  }
  entry.room.url = url;
  emitChanged();
}

export function listRooms(): HuddleRoom[] {
  return [...rooms.values()].map((e) => structuredClone(e.room));
}

export function getRoom(roomId: string): HuddleRoom | null {
  const entry = rooms.get(roomId);

  return entry ? structuredClone(entry.room) : null;
}

/** True while at least one room is open — the gate on accepting guest sockets. */
export function hasOpenRooms(): boolean {
  sweepRooms();

  return rooms.size > 0;
}

/** Constant-time token compare, so a wrong guess leaks no prefix. */
function tokenMatches(candidate: string, token: string): boolean {
  const a = Buffer.from(candidate);
  const b = Buffer.from(token);

  return a.length === b.length && timingSafeEqual(a, b);
}

function findByToken(token: string): RoomEntry | null {
  for (const entry of rooms.values()) {
    if (tokenMatches(token, entry.room.token)) {
      return entry;
    }
  }

  return null;
}

export type JoinOutcome =
  | { ok: false; reason: "denied" | "unknown_room" }
  | { ok: true; room_id: string; payload: HuddleStatePayload };

/**
 * A browser presenting a room token. Records a **pending** guest — the token
 * buys a place in the queue and nothing else. A key that was already approved
 * for this room is re-granted, so reloading the tab (or a dropped socket)
 * doesn't cost a second approval; a denied key stays denied.
 */
export function joinRoom(
  token: string,
  devStaticPub: string,
  label: string,
  link: GuestLink,
): JoinOutcome {
  sweepRooms();
  const entry = findByToken(token);
  if (!entry) {
    return { ok: false, reason: "unknown_room" };
  }
  const { room } = entry;
  let guest = room.guests.find((g) => g.dev_static_pub === devStaticPub);
  if (guest?.state === "denied") {
    return { ok: false, reason: "denied" };
  }
  if (!guest) {
    guest = {
      dev_static_pub: devStaticPub,
      label,
      state: "pending",
      joined_at: Date.now(),
      approved_at: null,
      connected: true,
    };
    room.guests.push(guest);
  } else {
    guest.label = label;
    guest.connected = true;
  }
  entry.links.set(devStaticPub, link);
  if (guest.state === "approved") {
    link.grant(guestScope(room));
  }
  emitChanged();

  return {
    ok: true,
    room_id: room.id,
    payload: statePayload(room, guest, guest.state),
  };
}

/** This guest's current standing, for a `huddle.state` request. */
export function guestState(
  roomId: string,
  devStaticPub: string,
): HuddleStatePayload | null {
  const entry = rooms.get(roomId);
  const guest = entry?.room.guests.find(
    (g) => g.dev_static_pub === devStaticPub,
  );

  return entry && guest ? statePayload(entry.room, guest, guest.state) : null;
}

/** The host said yes: mint the scoped grant on the guest's live socket. */
export function approveGuest(roomId: string, devStaticPub: string): boolean {
  const entry = rooms.get(roomId);
  const guest = entry?.room.guests.find(
    (g) => g.dev_static_pub === devStaticPub,
  );
  if (!entry || !guest || guest.state === "approved") {
    return false;
  }
  guest.state = "approved";
  guest.approved_at = Date.now();
  const link = entry.links.get(devStaticPub);
  link?.grant(guestScope(entry.room));
  link?.notify(statePayload(entry.room, guest, "approved"));
  emitChanged();

  return true;
}

/** The host said no, or revoked one guest mid-huddle. */
export function denyGuest(roomId: string, devStaticPub: string): boolean {
  const entry = rooms.get(roomId);
  const guest = entry?.room.guests.find(
    (g) => g.dev_static_pub === devStaticPub,
  );
  if (!entry || !guest) {
    return false;
  }
  guest.state = "denied";
  guest.approved_at = null;
  guest.connected = false;
  const link = entry.links.get(devStaticPub);
  entry.links.delete(devStaticPub);
  link?.notify(statePayload(entry.room, guest, "denied"));
  link?.revoke();
  emitChanged();

  return true;
}

/**
 * A guest socket went away. Approved guests are kept — their key stays good so
 * a reload rejoins silently — but a guest who never got past pending leaves no
 * stale "wants to join" prompt behind.
 */
export function leaveGuest(roomId: string, devStaticPub: string): void {
  const entry = rooms.get(roomId);
  if (!entry) {
    return;
  }
  entry.links.delete(devStaticPub);
  const guest = entry.room.guests.find(
    (g) => g.dev_static_pub === devStaticPub,
  );
  if (!guest) {
    return;
  }
  if (guest.state === "pending") {
    entry.room.guests = entry.room.guests.filter(
      (g) => g.dev_static_pub !== devStaticPub,
    );
  } else {
    guest.connected = false;
  }
  emitChanged();
}

function closeRoom(entry: RoomEntry): void {
  for (const [pub, link] of entry.links) {
    const guest = entry.room.guests.find((g) => g.dev_static_pub === pub);
    link.notify(statePayload(entry.room, guest ?? null, "ended"));
    link.revoke();
  }
  entry.links.clear();
  rooms.delete(entry.room.id);
  roomEnded?.();
}

/** End a room: every guest grant revoked, every guest socket dropped. */
export function endRoom(roomId: string): boolean {
  const entry = rooms.get(roomId);
  if (!entry) {
    return false;
  }
  closeRoom(entry);
  stopSweep();
  emitChanged();

  return true;
}

/** Shutdown / kill-switch: no room outlives the gateway. */
export function endAllRooms(): void {
  if (rooms.size === 0) {
    return;
  }
  for (const entry of [...rooms.values()]) {
    closeRoom(entry);
  }
  stopSweep();
  emitChanged();
}

/** Drop rooms past their backstop. Idempotent; safe to call on any path. */
export function sweepRooms(now: number = Date.now()): number {
  let ended = 0;
  for (const entry of [...rooms.values()]) {
    if (entry.room.expires_at <= now) {
      closeRoom(entry);
      ended += 1;
    }
  }
  if (ended > 0) {
    stopSweep();
    emitChanged();
  }

  return ended;
}

/** Test-only: forget every room without notifying anyone. */
export function resetRooms(): void {
  rooms.clear();
  stopSweep();
  roomEnded = null;
}
