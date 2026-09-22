/**
 * Whose message is this? Unattributed is right alone and ambiguous in a huddle,
 * where it could be any of the people reading along.
 */

import type { HuddleRoom } from "./types";
import { beforeEach, describe, expect, it } from "vitest";
import { setHuddleRooms } from "../stores/huddleStore";
import { huddleAuthor } from "./huddleAuthor";

function room(overrides: Partial<HuddleRoom> = {}): HuddleRoom {
  return {
    id: "room-1",
    token: "tok",
    agent_id: "agent-1",
    device_key: "",
    url: null,
    created_at: 1,
    expires_at: 2,
    guests: [],
    host_label: "Ana Dev",
    ...overrides,
  };
}

describe("stamping the host's own messages", () => {
  beforeEach(() => setHuddleRooms([]));

  it("says nothing when the agent isn't shared", () => {
    expect(huddleAuthor("agent-1")).toBeUndefined();
  });

  it("names the host once guests are reading along", () => {
    setHuddleRooms([room()]);
    expect(huddleAuthor("agent-1")).toBe("Ana Dev");
  });

  it("leaves a message bare rather than labelling it with an empty name", () => {
    setHuddleRooms([room({ host_label: "" })]);
    expect(huddleAuthor("agent-1")).toBeUndefined();
  });

  it("only stamps the shared agent, not its neighbours", () => {
    setHuddleRooms([room()]);
    expect(huddleAuthor("agent-2")).toBeUndefined();
  });

  it("copes with no agent at all", () => {
    setHuddleRooms([room()]);
    expect(huddleAuthor(null)).toBeUndefined();
  });
});
