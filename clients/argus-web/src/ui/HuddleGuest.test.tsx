// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { HuddleView } from "../lib/huddleSession";
import { HuddleGuest } from "./HuddleGuest";

const joinHuddle = vi.fn();
let huddle: HuddleView | null = null;

vi.mock("../lib/store", () => ({
  useAppStore: (select: (s: unknown) => unknown) =>
    select({
      huddle,
      joinHuddle,
      connection: "ready",
      statusByAgent: {},
      devices: [],
      loadAgentStatus: vi.fn(),
      refreshDevices: vi.fn(),
    }),
}));

describe("the huddle guest", () => {
  beforeEach(() => {
    joinHuddle.mockClear();
    huddle = null;
    localStorage.setItem("argus.huddle.label", "Sam");
  });

  it("joins once for a token", () => {
    const { rerender } = render(<HuddleGuest token="tok-1" />);
    huddle = {
        state: "pending", roomId: "r1", agentId: null, deviceKey: null,
        members: [], you: null, hostTyping: false, hostLabel: "", chat: [],
      };
    rerender(<HuddleGuest token="tok-1" />);

    expect(joinHuddle).toHaveBeenCalledTimes(1);
  });

  it("joins a fresh link even when the last huddle ended", () => {
    huddle = {
      state: "ended", roomId: "r1", agentId: null, deviceKey: null,
      members: [], you: null, hostTyping: false, hostLabel: "", chat: [],
    };
    const { rerender } = render(<HuddleGuest token="tok-1" />);
    expect(screen.getByText("The huddle ended")).toBeTruthy();

    rerender(<HuddleGuest token="tok-2" />);

    expect(joinHuddle).toHaveBeenLastCalledWith("tok-2", "Sam");
  });
});
