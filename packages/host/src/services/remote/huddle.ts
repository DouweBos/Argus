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
import { getClaim } from "./deviceClaims";

/** Backstop lifetime for a forgotten share. The engineer normally ends it. */
export const ROOM_TTL_MS = 4 * 60 * 60 * 1000;

/** How often the backstop is checked. Cheap: rooms are a handful at most. */
const SWEEP_INTERVAL_MS = 60_000;

/** A live guest socket, as far as the room store needs to care. */
export interface GuestLink {
  /**
   * The gateway connection behind this guest. Matched against the device
   * claim's holder so "driving" follows the socket, not the display name —
   * two guests may well answer to the same one.
   */
  connectionId: string;
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

/**
 * The connection each guest is on right now, by key. Only a connected guest can
 * be holding the device, so a missing entry simply isn't driving.
 */
function connectionIds(entry: RoomEntry): Map<string, string> {
  const ids = new Map<string, string>();
  for (const [pub, link] of entry.links) {
    ids.set(pub, link.connectionId);
  }

  return ids;
}

function statePayload(
  room: HuddleRoom,
  guest: HuddleGuest | null,
  state: HuddleStatePayload["state"],
  connections?: Map<string, string>,
): HuddleStatePayload {
  // A guest that is not approved learns nothing about the room beyond its id —
  // not the agent, not the device, not who else is in it.
  const approved = state === "approved" && guest?.state === "approved";
  // At most one person ever holds the device, and only while the room has one.
  const holder = approved && room.device_key ? getClaim(room.device_key) : null;

  return {
    room_id: room.id,
    state,
    agent_id: approved ? room.agent_id : null,
    device_key: approved && room.device_key ? room.device_key : null,
    // Only the people the host has let in: a pending guest is the host's
    // decision to announce, not something the room leaks early.
    members: approved
      ? room.guests
          .filter((g) => g.state === "approved")
          .map((g) => ({
            member_id: g.member_id,
            label: g.label,
            connected: g.connected,
            driving:
              holder != null &&
              connections?.get(g.dev_static_pub) === holder.connection_id,
          }))
      : [],
    you: approved ? (guest?.member_id ?? null) : null,
    host_label: approved ? room.host_label : "",
  };
}

/**
 * Tell everyone already inside that the room's membership moved. Called
 * wherever the guest list changes, so a guest's "People" list is pushed rather
 * than polled — and so someone being removed is visible to the rest.
 */
function pushRoster(entry: RoomEntry): void {
  const connections = connectionIds(entry);
  for (const [pub, link] of entry.links) {
    const guest = entry.room.guests.find((g) => g.dev_static_pub === pub);
    if (guest?.state !== "approved") {
      continue;
    }
    link.notify(statePayload(entry.room, guest, "approved", connections));
  }
}

/** A device changed hands — every room sharing it re-marks who is driving. */
export function refreshDriving(deviceId: string): void {
  for (const entry of rooms.values()) {
    if (entry.room.device_key === deviceId) {
      pushRoster(entry);
    }
  }
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
  /** What to call the engineer in this room. Empty when nothing is known. */
  host_label?: string;
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
    host_label: opts.host_label ?? "",
  };
  rooms.set(room.id, { room, links: new Map() });
  scheduleSweep();
  emitChanged();

  return room;
}

/**
 * Point a live room at a different device — the host opened, switched or closed
 * one while sharing. Guests mirror whatever the engineer has in front of them,
 * so the grant is re-minted on every approved socket and each is told the new
 * key; an empty key drops the device and leaves the huddle chat-only.
 */
export function setRoomDevice(roomId: string, deviceKey: string): boolean {
  const entry = rooms.get(roomId);
  if (!entry || entry.room.device_key === deviceKey) {
    return false;
  }
  entry.room.device_key = deviceKey;
  const scope = guestScope(entry.room);
  for (const [pub, link] of entry.links) {
    const guest = entry.room.guests.find((g) => g.dev_static_pub === pub);
    if (guest?.state !== "approved") {
      continue;
    }
    link.grant(scope);
    link.notify(statePayload(entry.room, guest, "approved"));
  }
  emitChanged();

  return true;
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

/**
 * What the engineer is called in the room sharing this agent, if any. Lets a
 * send arriving from the host's own devices be attributed too — inside a
 * huddle, an unattributed message could have come from anyone in it.
 */
export function hostLabelForAgent(agentId: string): string | undefined {
  for (const entry of rooms.values()) {
    if (entry.room.agent_id === agentId) {
      return entry.room.host_label || undefined;
    }
  }

  return undefined;
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
  clientId?: string,
): JoinOutcome {
  sweepRooms();
  const entry = findByToken(token);
  if (!entry) {
    return { ok: false, reason: "unknown_room" };
  }
  const { room } = entry;
  // The key identifies the tab; the client id identifies the person. Prefer the
  // key (a reload, same tab) and fall back to the client id (they closed the
  // tab and opened the link again) so one person is one row either way.
  let guest = room.guests.find((g) => g.dev_static_pub === devStaticPub);
  const returning = !guest && clientId != null;
  if (returning) {
    guest = room.guests.find((g) => g.client_id === clientId);
  }
  if (guest?.state === "denied") {
    return { ok: false, reason: "denied" };
  }
  if (!guest) {
    guest = {
      member_id: randomUUID(),
      dev_static_pub: devStaticPub,
      client_id: clientId ?? null,
      label,
      state: "pending",
      joined_at: Date.now(),
      approved_at: null,
      connected: true,
    };
    room.guests.push(guest);
  } else if (returning) {
    // A new tab handshook a new key, and the old grant was bound to the old
    // one. Rebind the row and ask the host again rather than re-granting
    // something this browser can no longer prove it held.
    entry.links.get(guest.dev_static_pub)?.revoke();
    entry.links.delete(guest.dev_static_pub);
    guest.dev_static_pub = devStaticPub;
    guest.label = label;
    guest.state = "pending";
    guest.approved_at = null;
    guest.connected = true;
  } else {
    guest.label = label;
    guest.connected = true;
    if (clientId != null) {
      guest.client_id = clientId;
    }
  }
  entry.links.set(devStaticPub, link);
  if (guest.state === "approved") {
    link.grant(guestScope(room));
  }
  pushRoster(entry);
  emitChanged();

  return {
    ok: true,
    room_id: room.id,
    payload: statePayload(room, guest, guest.state),
  };
}

/**
 * Take one guest out of the room entirely: grant revoked, socket dropped, row
 * gone. Unlike {@link denyGuest} this leaves no "turned away" tombstone, so it
 * doubles as the way to clear someone who has drifted out of a long huddle —
 * and they may ask to come back in.
 */
export function removeGuest(roomId: string, devStaticPub: string): boolean {
  const entry = rooms.get(roomId);
  const guest = entry?.room.guests.find(
    (g) => g.dev_static_pub === devStaticPub,
  );
  if (!entry || !guest) {
    return false;
  }
  entry.room.guests = entry.room.guests.filter(
    (g) => g.dev_static_pub !== devStaticPub,
  );
  const link = entry.links.get(devStaticPub);
  entry.links.delete(devStaticPub);
  link?.revoke();
  pushRoster(entry);
  emitChanged();

  return true;
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
  pushRoster(entry);
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
  pushRoster(entry);
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
  pushRoster(entry);
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
