import { describe, expect, it, vi } from "vitest";
import {
  applyHuddleState,
  applyJoinFailure,
  huddleCapabilities,
  huddlePanes,
  INITIAL_HUDDLE_VIEW,
  applyHuddleChat,
  requestJoin,
  typingNames,
  type HuddleView,
} from "./huddleSession";
import type { HuddleStatePayload } from "./protocol";

const PENDING: HuddleStatePayload = {
  room_id: "room-1",
  state: "pending",
  agent_id: null,
  device_key: null,
};
const APPROVED: HuddleStatePayload = {
  room_id: "room-1",
  state: "approved",
  agent_id: "ag1",
  device_key: "udid-1",
};

function requester(result: Promise<unknown>) {
  return { request: vi.fn(() => result) as never };
}

class WireError extends Error {
  constructor(readonly code: string) {
    super(code);
  }
}

describe("joining a huddle", () => {
  it("presents the token with a label and lands pending", async () => {
    const transport = requester(Promise.resolve(PENDING));

    const view = await requestJoin(transport, "tok", "Ana");

    expect(transport.request).toHaveBeenCalledWith("huddle.join", {
      token: "tok",
      label: "Ana",
    });
    expect(view).toEqual({
      state: "pending",
      roomId: "room-1",
      agentId: null,
      deviceKey: null, members: [], you: null, hostTyping: false, hostLabel: "", chat: []
    });
  });

  it("learns nothing about the room while pending", () => {
    const view = applyHuddleState(PENDING);

    expect([view.agentId, view.deviceKey]).toEqual([null, null]);
    expect(huddleCapabilities(view.state)).toEqual([]);
    expect(huddlePanes(view)).toEqual([]);
  });

  it("upgrades in place when the host approves the live socket", () => {
    const view = applyHuddleState(APPROVED);

    expect(view).toEqual({
      state: "approved",
      roomId: "room-1",
      agentId: "ag1",
      deviceKey: "udid-1", members: [], you: null, hostTyping: false, hostLabel: "", chat: []
    });
    expect(huddleCapabilities(view.state)).toEqual(["monitor", "control"]);
  });

  it("re-grants a reloaded tab without a second approval", async () => {
    // Same ephemeral key, so the host answers the join with `approved`
    // directly — no pending round trip, no prompt on the host.
    const transport = requester(Promise.resolve(APPROVED));

    const view = await requestJoin(transport, "tok", "Ana");

    expect(view.state).toBe("approved");
    expect(view.agentId).toBe("ag1");
  });

  it("treats a refusal as final and a missing room as a dead link", async () => {
    const denied = await requestJoin(
      requester(Promise.reject(new WireError("capability_denied"))),
      "tok",
      "Ana",
    );
    const gone = await requestJoin(
      requester(Promise.reject(new WireError("not_found"))),
      "tok",
      "Ana",
    );

    expect(denied.state).toBe("denied");
    expect(gone.state).toBe("unavailable");
  });

  it("keeps connecting through a transient failure so the retry can land", () => {
    expect(applyJoinFailure("timeout", INITIAL_HUDDLE_VIEW).state).toBe(
      "connecting",
    );
  });

  it("ends the huddle when the host closes the room", () => {
    const view = applyHuddleState({ ...APPROVED, state: "ended" });

    expect(view.state).toBe("ended");
    expect(huddleCapabilities(view.state)).toEqual([]);
    expect(huddlePanes(view)).toEqual([]);
  });
});

describe("what a guest is offered", () => {
  const approved: HuddleView = {
    state: "approved",
    roomId: "room-1",
    agentId: "ag1",
    deviceKey: "udid-1", members: [], you: null,
    hostTyping: false, hostLabel: "", chat: []
  };

  it("offers one agent and one device, and nothing else", () => {
    expect(huddlePanes(approved)).toEqual(["agent", "chat", "device"]);
  });

  it("drops the device pane when the room has no device", () => {
    expect(huddlePanes({ ...approved, deviceKey: "", members: [], you: null })).toEqual(["agent", "chat"]);
  });

  it("drops the device pane for an embedded browser it cannot render", () => {
    expect(
      huddlePanes({ ...approved, deviceKey: "browser:s1", members: [], you: null }),
    ).toEqual(["agent", "chat"]);
  });

  it.each(["connecting", "pending", "denied", "ended", "unavailable"] as const)(
    "offers nothing while %s",
    (state) => {
      expect(huddlePanes({ ...approved, state })).toEqual([]);
      expect(huddleCapabilities(state)).toEqual([]);
    },
  );
});

describe("naming the host", () => {
  const view = (over: Partial<HuddleView> = {}): HuddleView => ({
    ...INITIAL_HUDDLE_VIEW,
    state: "approved",
    ...over,
  });

  it("uses the name the desktop sent", () => {
    expect(
      typingNames(view({ hostTyping: true, hostLabel: "Ana Dev" })),
    ).toEqual(["Ana Dev"]);
  });

  it("falls back to 'The host' when the desktop knows no name", () => {
    expect(typingNames(view({ hostTyping: true }))).toEqual(["The host"]);
  });

  it("puts the host first — they are the one everyone is waiting on", () => {
    expect(
      typingNames(
        view({
          hostTyping: true,
          hostLabel: "Ana Dev",
          members: [
            {
              member_id: "m1",
              label: "Bo",
              connected: true,
              typing: true,
            },
          ],
        }),
      ),
    ).toEqual(["Ana Dev", "Bo"]);
  });

  it("says nobody is typing when nobody is", () => {
    expect(typingNames(view({ hostLabel: "Ana Dev" }))).toEqual([]);
  });
});

describe("the room's side chat, as a guest folds it in", () => {
  const view = (chat: HuddleView["chat"] = []): HuddleView => ({
    ...INITIAL_HUDDLE_VIEW,
    state: "approved",
    chat,
  });
  const line = (id: string, text: string) => ({
    id,
    author: "Ana",
    member_id: null,
    text,
    at: 1,
  });

  it("appends what someone just said", () => {
    const next = applyHuddleChat(
      { room_id: "r", messages: [line("2", "second")] },
      view([line("1", "first")]),
    );

    expect(next.chat.map((m) => m.text)).toEqual(["first", "second"]);
  });

  it("replaces the log with the backlog handed over on approval", () => {
    const next = applyHuddleChat(
      { room_id: "r", messages: [line("9", "the room's own record")], replace: true },
      view([line("1", "stale")]),
    );

    expect(next.chat.map((m) => m.text)).toEqual(["the room's own record"]);
  });

  it("never doubles a line it already holds", () => {
    const next = applyHuddleChat(
      { room_id: "r", messages: [line("1", "first")] },
      view([line("1", "first")]),
    );

    expect(next.chat).toHaveLength(1);
  });

  it("survives a roster change — typing must not wipe what was said", () => {
    const next = applyHuddleState(
      { room_id: "r", state: "approved", agent_id: "ag1", device_key: null },
      view([line("1", "first")]),
    );

    expect(next.chat.map((m) => m.text)).toEqual(["first"]);
  });
});
