/**
 * The host's `huddle:changed` broadcast is the only thing that moves this
 * store: a guest going pending → approved, and a room ending, both have to
 * show up in the UI without anyone asking the host a question.
 */

import type { HuddleGuest, HuddleRoom } from "../lib/types";
import { beforeEach, describe, expect, it, vi } from "vitest";

type Handler = (event: { hostId: string; payload: unknown }) => void;

const handlers = new Map<string, Handler>();
const huddleListMock = vi.fn(() => Promise.resolve([] as HuddleRoom[]));

vi.mock("../lib/events", () => ({
  listen: (event: string, handler: Handler) => {
    handlers.set(event, handler);

    return Promise.resolve(() => handlers.delete(event));
  },
}));

vi.mock("../lib/ipc", () => ({
  huddleList: () => huddleListMock(),
}));

const {
  approvedGuests,
  getHuddleRoomForAgent,
  getHuddleState,
  initHuddleRooms,
  pendingGuests,
  setHuddleState,
} = await import("./huddleStore");

function guest(overrides: Partial<HuddleGuest> = {}): HuddleGuest {
  return {
    member_id: "mem-a",
    dev_static_pub: "pub-a",
    client_id: null,
    label: "Ana",
    state: "pending",
    joined_at: 1,
    approved_at: null,
    connected: true,
    ...overrides,
  };
}

function room(overrides: Partial<HuddleRoom> = {}): HuddleRoom {
  return {
    id: "room-1",
    token: "tok",
    agent_id: "agent-1",
    device_key: "SIM-1",
    url: "https://example.test/#/huddle/tok",
    created_at: 1,
    expires_at: 2,
    guests: [],
    ...overrides,
  };
}

/** Publish what the host would publish. */
function broadcast(rooms: HuddleRoom[]): void {
  handlers.get("huddle:changed")?.({ hostId: "local", payload: { rooms } });
}

describe("huddleStore", () => {
  beforeEach(() => {
    handlers.clear();
    huddleListMock.mockClear();
    setHuddleState({ rooms: [] });
    initHuddleRooms();
  });

  it("shows a room for its agent once the host announces it", () => {
    broadcast([room()]);
    expect(getHuddleRoomForAgent("agent-1")?.url).toBe(
      "https://example.test/#/huddle/tok",
    );
    expect(getHuddleRoomForAgent("agent-2")).toBeNull();
  });

  it("moves a guest from waiting to in the huddle on approval", () => {
    broadcast([room({ guests: [guest()] })]);
    expect(pendingGuests(getHuddleRoomForAgent("agent-1"))).toHaveLength(1);
    expect(approvedGuests(getHuddleRoomForAgent("agent-1"))).toHaveLength(0);

    broadcast([
      room({ guests: [guest({ state: "approved", approved_at: 5 })] }),
    ]);
    expect(pendingGuests(getHuddleRoomForAgent("agent-1"))).toHaveLength(0);
    expect(approvedGuests(getHuddleRoomForAgent("agent-1"))).toHaveLength(1);
  });

  it("keeps a denied guest out of both lists", () => {
    broadcast([room({ guests: [guest({ state: "denied" })] })]);
    const live = getHuddleRoomForAgent("agent-1");
    expect(pendingGuests(live)).toHaveLength(0);
    expect(approvedGuests(live)).toHaveLength(0);
  });

  it("holds every pending guest — there is no cap", () => {
    broadcast([
      room({
        guests: [
          guest({ dev_static_pub: "a", label: "Ana" }),
          guest({ dev_static_pub: "b", label: "Ben" }),
          guest({ dev_static_pub: "c", label: "Chidi" }),
        ],
      }),
    ]);
    expect(
      pendingGuests(getHuddleRoomForAgent("agent-1")).map((g) => g.label),
    ).toEqual(["Ana", "Ben", "Chidi"]);
  });

  it("clears the UI when the room ends", () => {
    broadcast([room({ guests: [guest({ state: "approved" })] })]);
    broadcast([]);
    expect(getHuddleState().rooms).toEqual([]);
    expect(getHuddleRoomForAgent("agent-1")).toBeNull();
    expect(pendingGuests(null)).toEqual([]);
  });

  it("ends only the room that ended, leaving the other share live", () => {
    broadcast([room(), room({ id: "room-2", agent_id: "agent-2" })]);
    broadcast([room({ id: "room-2", agent_id: "agent-2" })]);
    expect(getHuddleRoomForAgent("agent-1")).toBeNull();
    expect(getHuddleRoomForAgent("agent-2")?.id).toBe("room-2");
  });

  it("hydrates once on init, for a room opened from another window", () => {
    expect(huddleListMock).toHaveBeenCalledTimes(1);
  });
});
