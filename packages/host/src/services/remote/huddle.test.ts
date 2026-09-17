/**
 * The room store. The property under test throughout is the one the whole
 * feature rests on: presenting a valid token never mints a grant — only the
 * host approving does.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@argus/host/bus", () => ({ emitHostEvent: vi.fn() }));

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
  resetRooms,
  setRoomEndedListener,
  setRoomUrl,
  sweepRooms,
} = await import("./huddle");

function link() {
  return {
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
    expect(l.notify).toHaveBeenCalledWith({
      room_id: r.id,
      state: "approved",
      agent_id: "ag1",
      device_key: "udid-1",
    });
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
