/**
 * The huddle wrappers are the console's only way to mint a link, let a guest
 * in, or end a share. Their channel names are asserted against the host-only
 * set, so a typo here would silently register a *new*, unlisted command.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const invokeMock = vi.fn(() => Promise.resolve(undefined as unknown));

const transport = { invoke: invokeMock, on: vi.fn(), send: vi.fn() };

vi.mock("./transport", () => ({
  getTransport: () => transport,
  getTransportFor: () => transport,
  getTransportForCommand: () => transport,
  isRemoteMode: () => false,
}));

const { HOST_ONLY_COMMANDS } = await import("@argus/remote-protocol");
const {
  huddleApproveGuest,
  huddleDenyGuest,
  huddleList,
  huddleStart,
  huddleStop,
} = await import("./ipc");

function lastCall(): [string, Record<string, unknown>] {
  const call = invokeMock.mock.calls.at(-1) as unknown as [
    string,
    Record<string, unknown>,
  ];

  return call;
}

describe("huddle ipc wrappers", () => {
  beforeEach(() => {
    invokeMock.mockClear();
  });

  it("starts a share for one agent plus whatever device is open", async () => {
    await huddleStart("agent-1", "SIM-UDID");
    expect(lastCall()).toEqual([
      "huddle_start",
      { agentId: "agent-1", deviceKey: "SIM-UDID" },
    ]);
  });

  it("starts a chat-only share when no device is open", async () => {
    await huddleStart("agent-1", "");
    expect(lastCall()[1]).toEqual({ agentId: "agent-1", deviceKey: "" });
  });

  it("ends one room by id", async () => {
    await huddleStop("room-1");
    expect(lastCall()).toEqual(["huddle_stop", { roomId: "room-1" }]);
  });

  it("lists rooms", async () => {
    await huddleList();
    expect(lastCall()).toEqual(["huddle_list", {}]);
  });

  it("approves and denies a guest by its ephemeral key", async () => {
    await huddleApproveGuest("room-1", "pub-a");
    expect(lastCall()).toEqual([
      "huddle_approve_guest",
      { roomId: "room-1", devStaticPub: "pub-a" },
    ]);
    await huddleDenyGuest("room-1", "pub-b");
    expect(lastCall()).toEqual([
      "huddle_deny_guest",
      { roomId: "room-1", devStaticPub: "pub-b" },
    ]);
  });

  it("only speaks host-only commands — none of this may cross the wire", async () => {
    await huddleStart("a", "");
    await huddleStop("r");
    await huddleList();
    await huddleApproveGuest("r", "p");
    await huddleDenyGuest("r", "p");
    const channels = invokeMock.mock.calls.map(
      (c) => (c as unknown as [string])[0],
    );
    expect(channels).toHaveLength(5);
    for (const channel of channels) {
      expect(HOST_ONLY_COMMANDS.has(channel)).toBe(true);
    }
  });
});
