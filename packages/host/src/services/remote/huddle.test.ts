/**
 * The room store. The property under test throughout is the one the whole
 * feature rests on: presenting a valid token never mints a grant — only the
 * host approving does.
 */

import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@argus/host/bus", () => ({ emitHostEvent: vi.fn() }));

const { claimDevice, releaseDevice, resetClaims } =
  await import("./deviceClaims");

const {
  approveGuest,
  createRoom,
  denyGuest,
  endAllRooms,
  endRoom,
  getRoom,
  guestScope,
  guestState,
  hasOpenRooms,
  joinRoom,
  leaveGuest,
  listRooms,
  refreshDriving,
  removeGuest,
  resetRooms,
  setRoomDevice,
  setRoomEndedListener,
  setRoomUrl,
  sweepRooms,
} = await import("./huddle");

function link(connectionId = `conn-${randomUUID()}`) {
  return {
    connectionId,
    grant: vi.fn(),
    revoke: vi.fn(),
    notify: vi.fn(),
  };
}

function reset(): void {
  resetRooms();
  vi.clearAllMocks();
}

function room(overrides: { device_key?: string; ttl_ms?: number } = {}) {
  return createRoom({
    agent_id: "ag1",
    device_key: overrides.device_key ?? "udid-1",
    ...(overrides.ttl_ms === undefined ? {} : { ttl_ms: overrides.ttl_ms }),
  });
}

describe("creating a room", () => {
  beforeEach(reset);
  afterEach(resetRooms);

  it("mints a high-entropy token and a backstop expiry", () => {
    const r = room();

    expect(r.token.length).toBeGreaterThanOrEqual(40);
    expect(r.expires_at).toBeGreaterThan(r.created_at);
    expect(r.guests).toEqual([]);
    expect(hasOpenRooms()).toBe(true);
  });

  it("gives two rooms different tokens", () => {
    expect(room().token).not.toBe(room().token);
  });

  it("scopes guests to exactly its agent and device", () => {
    expect(guestScope(room())).toEqual({
      agent_ids: ["ag1"],
      device_keys: ["udid-1"],
    });
  });

  it("names no device when the host had none open", () => {
    expect(guestScope(room({ device_key: "" })).device_keys).toEqual([]);
  });

  it("carries the share link once the tunnel has one", () => {
    const r = room();
    setRoomUrl(r.id, "https://x.trycloudflare.com/#/huddle/t");

    expect(getRoom(r.id)?.url).toBe("https://x.trycloudflare.com/#/huddle/t");
  });
});

describe("joining with a token", () => {
  beforeEach(reset);
  afterEach(resetRooms);

  it("grants nothing — it only queues a pending guest", () => {
    const r = room();
    const l = link();
    const outcome = joinRoom(r.token, "pub-a", "Ana", l);

    expect(outcome).toMatchObject({ ok: true, room_id: r.id });
    expect(l.grant).not.toHaveBeenCalled();
    expect(getRoom(r.id)?.guests).toEqual([
      expect.objectContaining({ label: "Ana", state: "pending" }),
    ]);
  });

  it("tells a pending guest nothing about the room", () => {
    const r = room();
    const outcome = joinRoom(r.token, "pub-a", "Ana", link());

    expect(outcome).toMatchObject({
      ok: true,
      payload: { state: "pending", agent_id: null, device_key: null },
    });
  });

  it("refuses an unknown token", () => {
    room();

    expect(joinRoom("nope", "pub-a", "Ana", link())).toEqual({
      ok: false,
      reason: "unknown_room",
    });
  });

  it("refuses a token for a room that already ended", () => {
    const r = room();
    endRoom(r.id);

    expect(joinRoom(r.token, "pub-a", "Ana", link())).toEqual({
      ok: false,
      reason: "unknown_room",
    });
  });

  it("keeps a denied key denied", () => {
    const r = room();
    joinRoom(r.token, "pub-a", "Ana", link());
    denyGuest(r.id, "pub-a");

    expect(joinRoom(r.token, "pub-a", "Ana", link())).toEqual({
      ok: false,
      reason: "denied",
    });
  });

  it("re-grants an approved key without a second approval", () => {
    const r = room();
    joinRoom(r.token, "pub-a", "Ana", link());
    approveGuest(r.id, "pub-a");

    const reconnect = link();
    const outcome = joinRoom(r.token, "pub-a", "Ana", reconnect);

    expect(reconnect.grant).toHaveBeenCalledWith(guestScope(r));
    expect(outcome).toMatchObject({ payload: { state: "approved" } });
  });
});

describe("approval", () => {
  beforeEach(reset);
  afterEach(resetRooms);

  it("mints a grant scoped to exactly the room's agent and device", () => {
    const r = room();
    const l = link();
    joinRoom(r.token, "pub-a", "Ana", l);
    approveGuest(r.id, "pub-a");

    expect(l.grant).toHaveBeenCalledWith({
      agent_ids: ["ag1"],
      device_keys: ["udid-1"],
    });
    expect(l.notify).toHaveBeenCalledWith(
      expect.objectContaining({
        room_id: r.id,
        state: "approved",
        agent_id: "ag1",
        device_key: "udid-1",
      }),
    );
  });

  it("does nothing for a key that never joined", () => {
    const r = room();

    expect(approveGuest(r.id, "ghost")).toBe(false);
  });

  it("is idempotent", () => {
    const r = room();
    joinRoom(r.token, "pub-a", "Ana", link());

    expect(approveGuest(r.id, "pub-a")).toBe(true);
    expect(approveGuest(r.id, "pub-a")).toBe(false);
  });

  it("reports state back to the guest", () => {
    const r = room();
    joinRoom(r.token, "pub-a", "Ana", link());

    expect(guestState(r.id, "pub-a")).toMatchObject({ state: "pending" });
    approveGuest(r.id, "pub-a");
    expect(guestState(r.id, "pub-a")).toMatchObject({
      state: "approved",
      agent_id: "ag1",
    });
  });
});

describe("denial", () => {
  beforeEach(reset);
  afterEach(resetRooms);

  it("revokes the grant and drops the socket", () => {
    const r = room();
    const l = link();
    joinRoom(r.token, "pub-a", "Ana", l);
    approveGuest(r.id, "pub-a");
    denyGuest(r.id, "pub-a");

    expect(l.revoke).toHaveBeenCalled();
    expect(l.notify).toHaveBeenLastCalledWith(
      expect.objectContaining({ state: "denied", agent_id: null }),
    );
  });
});

describe("several guests in one room", () => {
  beforeEach(reset);
  afterEach(resetRooms);

  it("approves each individually", () => {
    const r = room();
    const a = link();
    const b = link();
    joinRoom(r.token, "pub-a", "Ana", a);
    joinRoom(r.token, "pub-b", "Bo", b);
    approveGuest(r.id, "pub-a");

    expect(a.grant).toHaveBeenCalledWith(guestScope(r));
    expect(b.grant).not.toHaveBeenCalled();

    approveGuest(r.id, "pub-b");

    expect(b.grant).toHaveBeenCalledWith(guestScope(r));
    expect(getRoom(r.id)?.guests).toHaveLength(2);
  });

  it("denying one leaves the other running", () => {
    const r = room();
    const a = link();
    const b = link();
    joinRoom(r.token, "pub-a", "Ana", a);
    joinRoom(r.token, "pub-b", "Bo", b);
    approveGuest(r.id, "pub-a");
    approveGuest(r.id, "pub-b");
    denyGuest(r.id, "pub-b");

    expect(a.revoke).not.toHaveBeenCalled();
    expect(b.revoke).toHaveBeenCalled();
  });
});

describe("a guest socket going away", () => {
  beforeEach(reset);
  afterEach(resetRooms);

  it("forgets a guest who never got approved", () => {
    const r = room();
    joinRoom(r.token, "pub-a", "Ana", link());
    leaveGuest(r.id, "pub-a");

    expect(getRoom(r.id)?.guests).toEqual([]);
  });

  it("keeps an approved guest so a reload rejoins silently", () => {
    const r = room();
    joinRoom(r.token, "pub-a", "Ana", link());
    approveGuest(r.id, "pub-a");
    leaveGuest(r.id, "pub-a");

    expect(getRoom(r.id)?.guests).toEqual([
      expect.objectContaining({ state: "approved", connected: false }),
    ]);
  });
});

describe("ending a room", () => {
  beforeEach(reset);
  afterEach(resetRooms);

  it("revokes every guest and tells them it ended", () => {
    const r = room();
    const a = link();
    const b = link();
    joinRoom(r.token, "pub-a", "Ana", a);
    joinRoom(r.token, "pub-b", "Bo", b);
    approveGuest(r.id, "pub-a");

    expect(endRoom(r.id)).toBe(true);

    for (const l of [a, b]) {
      expect(l.revoke).toHaveBeenCalled();
      expect(l.notify).toHaveBeenLastCalledWith(
        expect.objectContaining({ state: "ended", agent_id: null }),
      );
    }
    expect(listRooms()).toEqual([]);
  });

  it("releases the room's URL lease exactly once", () => {
    const ended = vi.fn();
    setRoomEndedListener(ended);
    const r = room();
    endRoom(r.id);
    endRoom(r.id);

    expect(ended).toHaveBeenCalledTimes(1);
  });

  it("ends every room on shutdown", () => {
    const ended = vi.fn();
    setRoomEndedListener(ended);
    const a = link();
    room();
    const r2 = room();
    joinRoom(r2.token, "pub-a", "Ana", a);
    endAllRooms();

    expect(ended).toHaveBeenCalledTimes(2);
    expect(a.revoke).toHaveBeenCalled();
    expect(hasOpenRooms()).toBe(false);
  });
});

describe("the expiry backstop", () => {
  beforeEach(reset);
  afterEach(resetRooms);

  it("sweeps a room past its deadline and drops its guests", () => {
    const ended = vi.fn();
    setRoomEndedListener(ended);
    const r = room({ ttl_ms: 1000 });
    const l = link();
    joinRoom(r.token, "pub-a", "Ana", l);

    expect(sweepRooms(r.expires_at - 1)).toBe(0);
    expect(sweepRooms(r.expires_at)).toBe(1);
    expect(l.revoke).toHaveBeenCalled();
    expect(ended).toHaveBeenCalledTimes(1);
    expect(listRooms()).toEqual([]);
  });

  it("leaves a live room alone", () => {
    const r = room();
    sweepRooms();

    expect(getRoom(r.id)).not.toBeNull();
  });

  it("refuses a join through an expired token", () => {
    const r = room({ ttl_ms: -1 });

    expect(joinRoom(r.token, "pub-a", "Ana", link())).toEqual({
      ok: false,
      reason: "unknown_room",
    });
  });
});

describe("mirroring the host's device", () => {
  beforeEach(reset);
  afterEach(resetRooms);

  it("re-grants approved guests onto the new device and tells them", () => {
    const r = room({ device_key: "" });
    const l = link();
    joinRoom(r.token, "pub-1", "Sam", l);
    approveGuest(r.id, "pub-1");
    l.grant.mockClear();
    l.notify.mockClear();

    expect(setRoomDevice(r.id, "udid-9")).toBe(true);

    expect(l.grant).toHaveBeenCalledWith({
      agent_ids: ["ag1"],
      device_keys: ["udid-9"],
    });
    expect(l.notify).toHaveBeenCalledWith(
      expect.objectContaining({ state: "approved", device_key: "udid-9" }),
    );
    expect(getRoom(r.id)?.device_key).toBe("udid-9");
  });

  it("drops the device again when the host closes it", () => {
    const r = room({ device_key: "udid-1" });
    const l = link();
    joinRoom(r.token, "pub-1", "Sam", l);
    approveGuest(r.id, "pub-1");

    setRoomDevice(r.id, "");

    expect(guestScope(getRoom(r.id)!).device_keys).toEqual([]);
    expect(l.notify).toHaveBeenLastCalledWith(
      expect.objectContaining({ device_key: null }),
    );
  });

  it("tells a pending guest nothing — they hold no grant to re-mint", () => {
    const r = room({ device_key: "" });
    const l = link();
    joinRoom(r.token, "pub-1", "Sam", l);
    l.notify.mockClear();

    setRoomDevice(r.id, "udid-9");

    expect(l.grant).not.toHaveBeenCalled();
    expect(l.notify).not.toHaveBeenCalled();
  });

  it("is a no-op when the device didn't actually change", () => {
    const r = room({ device_key: "udid-1" });
    const l = link();
    joinRoom(r.token, "pub-1", "Sam", l);
    approveGuest(r.id, "pub-1");
    l.grant.mockClear();

    expect(setRoomDevice(r.id, "udid-1")).toBe(false);
    expect(l.grant).not.toHaveBeenCalled();
  });
});

describe("a guest who closes the tab and comes back", () => {
  beforeEach(reset);
  afterEach(resetRooms);

  it("updates their row rather than adding a second one", () => {
    const r = room();
    joinRoom(r.token, "pub-1", "Douwe", link(), "client-a");
    approveGuest(r.id, "pub-1");
    leaveGuest(r.id, "pub-1");

    // New tab, new key, same browser.
    joinRoom(r.token, "pub-2", "Douwe", link(), "client-a");

    const guests = getRoom(r.id)!.guests;
    expect(guests).toHaveLength(1);
    expect(guests[0].dev_static_pub).toBe("pub-2");
    expect(guests[0].connected).toBe(true);
  });

  it("has to be let in again — the grant was bound to the old key", () => {
    const r = room();
    joinRoom(r.token, "pub-1", "Douwe", link(), "client-a");
    approveGuest(r.id, "pub-1");
    leaveGuest(r.id, "pub-1");

    const back = link();
    const outcome = joinRoom(r.token, "pub-2", "Douwe", back, "client-a");

    expect(outcome).toMatchObject({ ok: true });
    expect(getRoom(r.id)!.guests[0].state).toBe("pending");
    expect(back.grant).not.toHaveBeenCalled();
  });

  it("still re-grants a plain reload, which keeps its key", () => {
    const r = room();
    joinRoom(r.token, "pub-1", "Douwe", link(), "client-a");
    approveGuest(r.id, "pub-1");

    const reloaded = link();
    joinRoom(r.token, "pub-1", "Douwe", reloaded, "client-a");

    expect(getRoom(r.id)!.guests[0].state).toBe("approved");
    expect(reloaded.grant).toHaveBeenCalled();
  });

  it("drops the stale socket it replaced", () => {
    const r = room();
    const first = link();
    joinRoom(r.token, "pub-1", "Douwe", first, "client-a");
    approveGuest(r.id, "pub-1");

    joinRoom(r.token, "pub-2", "Douwe", link(), "client-a");

    expect(first.revoke).toHaveBeenCalled();
  });

  it("stays denied — reopening the link is not a way around a no", () => {
    const r = room();
    joinRoom(r.token, "pub-1", "Douwe", link(), "client-a");
    denyGuest(r.id, "pub-1");

    expect(joinRoom(r.token, "pub-2", "Douwe", link(), "client-a")).toEqual({
      ok: false,
      reason: "denied",
    });
  });

  it("keeps two different browsers apart", () => {
    const r = room();
    joinRoom(r.token, "pub-1", "Douwe", link(), "client-a");
    joinRoom(r.token, "pub-2", "Douwe", link(), "client-b");

    expect(getRoom(r.id)!.guests).toHaveLength(2);
  });
});

describe("removing a guest", () => {
  beforeEach(reset);
  afterEach(resetRooms);

  it("takes the row out and drops their socket", () => {
    const r = room();
    const l = link();
    joinRoom(r.token, "pub-1", "Douwe", l, "client-a");
    approveGuest(r.id, "pub-1");

    expect(removeGuest(r.id, "pub-1")).toBe(true);

    expect(getRoom(r.id)!.guests).toEqual([]);
    expect(l.revoke).toHaveBeenCalled();
  });

  it("leaves no tombstone, so they may ask to come back", () => {
    const r = room();
    joinRoom(r.token, "pub-1", "Douwe", link(), "client-a");
    approveGuest(r.id, "pub-1");
    removeGuest(r.id, "pub-1");

    const outcome = joinRoom(r.token, "pub-3", "Douwe", link(), "client-a");

    expect(outcome).toMatchObject({ ok: true });
    expect(getRoom(r.id)!.guests[0].state).toBe("pending");
  });
});

describe("what a guest is told about the room", () => {
  beforeEach(reset);
  afterEach(resetRooms);

  it("lists the other approved guests, and marks which one is them", () => {
    const r = room();
    const ana = link();
    joinRoom(r.token, "pub-a", "Ana", ana, "client-a");
    joinRoom(r.token, "pub-b", "Ben", link(), "client-b");
    approveGuest(r.id, "pub-a");
    approveGuest(r.id, "pub-b");

    const payload = ana.notify.mock.calls.at(-1)![0];
    expect(payload.members.map((m: { label: string }) => m.label)).toEqual([
      "Ana",
      "Ben",
    ]);
    const me = payload.members.find(
      (m: { label: string }) => m.label === "Ana",
    );
    expect(payload.you).toBe(me.member_id);
  });

  it("never names a guest the host hasn't let in yet", () => {
    const r = room();
    const ana = link();
    joinRoom(r.token, "pub-a", "Ana", ana, "client-a");
    approveGuest(r.id, "pub-a");
    ana.notify.mockClear();

    joinRoom(r.token, "pub-b", "Ben", link(), "client-b");

    const payload = ana.notify.mock.calls.at(-1)![0];
    expect(payload.members.map((m: { label: string }) => m.label)).toEqual([
      "Ana",
    ]);
  });

  it("tells a pending guest nothing about who is inside", () => {
    const r = room();
    joinRoom(r.token, "pub-a", "Ana", link(), "client-a");
    approveGuest(r.id, "pub-a");

    const outcome = joinRoom(r.token, "pub-b", "Ben", link(), "client-b");

    expect(outcome).toMatchObject({
      ok: true,
      payload: { members: [], you: null },
    });
  });

  it("pushes the roster when someone drops off", () => {
    const r = room();
    const ana = link();
    joinRoom(r.token, "pub-a", "Ana", ana, "client-a");
    joinRoom(r.token, "pub-b", "Ben", link(), "client-b");
    approveGuest(r.id, "pub-a");
    approveGuest(r.id, "pub-b");
    ana.notify.mockClear();

    leaveGuest(r.id, "pub-b");

    const members = ana.notify.mock.calls.at(-1)![0].members;
    expect(
      members.find((m: { label: string }) => m.label === "Ben").connected,
    ).toBe(false);
  });

  it("keeps one member id when a guest reopens the link", () => {
    const r = room();
    const first = link();
    joinRoom(r.token, "pub-a", "Ana", first, "client-a");
    approveGuest(r.id, "pub-a");
    const before = first.notify.mock.calls.at(-1)![0].you;

    leaveGuest(r.id, "pub-a");
    joinRoom(r.token, "pub-a2", "Ana", link(), "client-a");
    approveGuest(r.id, "pub-a2");

    expect(getRoom(r.id)!.guests[0].member_id).toBe(before);
  });
});

describe("who is driving the shared device", () => {
  beforeEach(() => {
    reset();
    resetClaims();
  });
  afterEach(() => {
    resetRooms();
    resetClaims();
  });

  function roomOfTwo() {
    const r = room({ device_key: "udid-1" });
    const ana = link("conn-ana");
    const ben = link("conn-ben");
    joinRoom(r.token, "pub-a", "Sam", ana, "client-a");
    joinRoom(r.token, "pub-b", "Sam", ben, "client-b");
    approveGuest(r.id, "pub-a");
    approveGuest(r.id, "pub-b");

    return { r, ana, ben };
  }

  function drivingLabels(l: ReturnType<typeof link>): string[] {
    return l.notify.mock.calls
      .at(-1)![0]
      .members.filter((m: { driving: boolean }) => m.driving)
      .map((m: { member_id: string }) => m.member_id);
  }

  it("marks the claim holder, by connection rather than by name", () => {
    const { r, ana } = roomOfTwo();
    // Both guests are called "Sam" — only the socket tells them apart.
    claimDevice("udid-1", {
      connectionId: "conn-ben",
      deviceId: "udid-1",
      label: "Sam",
    });
    refreshDriving("udid-1");

    const bensId = getRoom(r.id)!.guests[1].member_id;
    expect(drivingLabels(ana)).toEqual([bensId]);
  });

  it("nobody is driving a device that is free", () => {
    const { ana } = roomOfTwo();

    expect(drivingLabels(ana)).toEqual([]);
  });

  it("clears the mark when the device is let go", () => {
    const { ana } = roomOfTwo();
    claimDevice("udid-1", {
      connectionId: "conn-ben",
      deviceId: "udid-1",
      label: "Sam",
    });
    refreshDriving("udid-1");
    releaseDevice("udid-1", "conn-ben");
    refreshDriving("udid-1");

    expect(drivingLabels(ana)).toEqual([]);
  });

  it("ignores a claim on some other device", () => {
    const { ana } = roomOfTwo();
    claimDevice("udid-other", {
      connectionId: "conn-ben",
      deviceId: "udid-other",
      label: "Sam",
    });
    refreshDriving("udid-other");

    expect(drivingLabels(ana)).toEqual([]);
  });
});
