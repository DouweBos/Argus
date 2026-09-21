import { describe, expect, it, vi } from "vitest";
import {
  applyHuddleState,
  applyJoinFailure,
  huddleCapabilities,
  huddlePanes,
  INITIAL_HUDDLE_VIEW,
  requestJoin,
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
      deviceKey: null, members: [], you: null
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
      deviceKey: "udid-1", members: [], you: null
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
    deviceKey: "udid-1", members: [], you: null
  };

  it("offers one agent and one device, and nothing else", () => {
    expect(huddlePanes(approved)).toEqual(["agent", "device"]);
  });

  it("drops the device pane when the room has no device", () => {
    expect(huddlePanes({ ...approved, deviceKey: "", members: [], you: null })).toEqual(["agent"]);
  });

  it("drops the device pane for an embedded browser it cannot render", () => {
    expect(huddlePanes({ ...approved, deviceKey: "browser:s1", members: [], you: null })).toEqual([
      "agent",
    ]);
  });

  it.each(["connecting", "pending", "denied", "ended", "unavailable"] as const)(
    "offers nothing while %s",
    (state) => {
      expect(huddlePanes({ ...approved, state })).toEqual([]);
      expect(huddleCapabilities(state)).toEqual([]);
    },
  );
});
