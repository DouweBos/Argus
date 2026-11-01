// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { HuddleView } from "../lib/huddleSession";
import { HuddleGuest } from "./HuddleGuest";

const joinHuddle = vi.fn();
let huddle: HuddleView | null = null;

let wide = false;
vi.mock("./useIsWide", () => ({ useIsWide: () => wide }));
vi.mock("./AgentTranscript", () => ({ AgentTranscript: () => null }));
vi.mock("./ChatInput", () => ({ ChatInput: () => null }));

/** One state object behind every store the guest view reads. */
const fakeStore = () => ({
  huddle,
  joinHuddle,
  connection: "ready",
  statusByAgent: {},
  devices: [],
  loadAgentStatus: vi.fn(async () => {}),
  refreshDevices: vi.fn(async () => {}),
  sayInHuddle: vi.fn(),
  leaveHuddle: vi.fn(),
});
const select = (pick: (s: unknown) => unknown) => pick(fakeStore());

vi.mock("../stores/agents", () => ({
  useAgentsStore: (pick: (s: unknown) => unknown) => select(pick),
}));
vi.mock("../stores/connection", () => ({
  useConnectionStore: (pick: (s: unknown) => unknown) => select(pick),
}));
vi.mock("../stores/devices", () => ({
  useDevicesStore: (pick: (s: unknown) => unknown) => select(pick),
}));
vi.mock("../stores/huddle", () => ({
  useHuddleStore: (pick: (s: unknown) => unknown) => select(pick),
}));

describe("the huddle guest", () => {
  afterEach(cleanup);

  beforeEach(() => {
    joinHuddle.mockClear();
    huddle = null;
    wide = false;
    localStorage.setItem("argus.huddle.label", "Sam");
  });

  it("joins once for a token", () => {
    const { rerender } = render(<HuddleGuest token="tok-1" />);
    huddle = {
      state: "pending",
      roomId: "r1",
      agentId: null,
      deviceKey: null,
      members: [],
      you: null,
      hostTyping: false,
      hostLabel: "",
      chat: [],
    };
    rerender(<HuddleGuest token="tok-1" />);

    expect(joinHuddle).toHaveBeenCalledTimes(1);
  });

  it("joins a fresh link even when the last huddle ended", () => {
    huddle = {
      state: "ended",
      roomId: "r1",
      agentId: null,
      deviceKey: null,
      members: [],
      you: null,
      hostTyping: false,
      hostLabel: "",
      chat: [],
    };
    const { rerender } = render(<HuddleGuest token="tok-1" />);
    expect(screen.getByText("The huddle ended")).toBeTruthy();

    rerender(<HuddleGuest token="tok-2" />);

    expect(joinHuddle).toHaveBeenLastCalledWith("tok-2", "Sam");
  });

  describe("on a wide screen", () => {
    const room = (chat: HuddleView["chat"]): HuddleView => ({
      state: "approved",
      roomId: "r1",
      agentId: "a1",
      deviceKey: null,
      members: [],
      you: "me",
      hostTyping: false,
      hostLabel: "Host",
      chat,
    });
    const message = (id: string, member_id: string | null) => ({
      id,
      member_id,
      author: member_id ?? "Host",
      text: `said ${id}`,
      at: 0,
    });
    const chatColumn = () =>
      screen.getByText("said m1").closest("[data-collapsed]");

    beforeEach(() => {
      wide = true;
    });

    it("shows the room chat as a column beside the conversation", () => {
      huddle = room([message("m1", null)]);
      render(<HuddleGuest token="tok-1" />);

      expect(chatColumn()?.getAttribute("data-collapsed")).toBe("false");
    });

    it("brings a hidden chat back when someone else speaks", () => {
      huddle = room([message("m1", null)]);
      const { rerender } = render(<HuddleGuest token="tok-1" />);
      fireEvent.click(screen.getByLabelText("Chat with the room"));
      expect(chatColumn()?.getAttribute("data-collapsed")).toBe("true");

      huddle = room([message("m1", null), message("m2", "me")]);
      rerender(<HuddleGuest token="tok-1" />);
      expect(chatColumn()?.getAttribute("data-collapsed")).toBe("true");

      huddle = room([
        message("m1", null),
        message("m2", "me"),
        message("m3", "them"),
      ]);
      rerender(<HuddleGuest token="tok-1" />);
      expect(chatColumn()?.getAttribute("data-collapsed")).toBe("false");
    });
  });
});
