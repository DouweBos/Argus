/**
 * Live huddle rooms, as the host's own UI sees them.
 *
 * The host pushes the whole list on `huddle:changed` — on create, join,
 * approve, deny, leave, end and expiry — so this store is a mirror, never a
 * poll. Rooms live in the host's memory only: after a restart the list is
 * empty and every share is gone, which is the intended fail-safe.
 */

import type { HuddleGuest, HuddleRoom } from "../lib/types";
import { create } from "zustand";
import { useShallow } from "zustand/react/shallow";
import { listen } from "../lib/events";
import { huddleList } from "../lib/ipc";

interface HuddleStoreData {
  rooms: HuddleRoom[];
}

const huddleStore = create<HuddleStoreData>(() => ({ rooms: [] }));

/** Replace the mirror with what the host just published. */
export function setHuddleRooms(rooms: HuddleRoom[]): void {
  huddleStore.setState({ rooms });
}

export const useHuddleRooms = (): HuddleRoom[] =>
  huddleStore(useShallow((s) => s.rooms));

/** The live room sharing this agent, or null when it isn't shared. */
export const useHuddleRoomForAgent = (
  agentId: string | null,
): HuddleRoom | null =>
  huddleStore((s) => s.rooms.find((r) => r.agent_id === agentId) ?? null);

export function getHuddleRoomForAgent(agentId: string): HuddleRoom | null {
  return (
    huddleStore.getState().rooms.find((r) => r.agent_id === agentId) ?? null
  );
}

/** Guests still waiting on the host. Any number of them, in join order. */
export function pendingGuests(room: HuddleRoom | null): HuddleGuest[] {
  return (room?.guests ?? []).filter((g) => g.state === "pending");
}

/** Guests the host let in. Denied guests never show in the live list. */
export function approvedGuests(room: HuddleRoom | null): HuddleGuest[] {
  return (room?.guests ?? []).filter((g) => g.state === "approved");
}

/**
 * Mirror `huddle:changed` for the lifetime of the app, and hydrate once in
 * case a room was opened from another window.
 */
export function initHuddleRooms(): void {
  listen<{ rooms: HuddleRoom[] }>("huddle:changed", ({ payload }) => {
    setHuddleRooms(payload.rooms ?? []);
  }).catch(() => {});
  huddleList()
    .then(setHuddleRooms)
    .catch(() => {});
}

/** For tests */
export const getHuddleState = () => huddleStore.getState();
export const setHuddleState = huddleStore.setState.bind(huddleStore);
