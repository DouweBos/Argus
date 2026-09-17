// @vitest-environment jsdom
/**
 * The host's share surface is a mirror of `huddle:changed`: a guest appearing
 * puts an Allow/Deny decision on screen, approving takes it away, and ending
 * the room takes the whole thing away.
 */

import type * as IpcModule from "../../../lib/ipc";
import type { HuddleGuest, HuddleRoom } from "../../../lib/types";
import { act, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

type Handler = (event: { hostId: string; payload: unknown }) => void;

const handlers = new Map<string, Handler>();
const approveMock = vi.fn((_roomId: string, _pub: string) =>
  Promise.resolve(true),
);
const denyMock = vi.fn((_roomId: string, _pub: string) =>
  Promise.resolve(true),
);

vi.mock("../../../lib/events", () => ({
  listen: (event: string, handler: Handler) => {
    handlers.set(event, handler);

    return Promise.resolve(() => handlers.delete(event));
  },
}));

vi.mock("../../../lib/ipc", async (importOriginal) => ({
  ...(await importOriginal<typeof IpcModule>()),
  huddleApproveGuest: (roomId: string, pub: string) => approveMock(roomId, pub),
  huddleDenyGuest: (roomId: string, pub: string) => denyMock(roomId, pub),
  huddleList: () => Promise.resolve([]),
}));

const { HuddleJoinRequests } = await import("./HuddleJoinRequests");
const { ShareAgentButton } = await import("./ShareAgentButton");
const { initHuddleRooms, setHuddleState } =
  await import("../../../stores/huddleStore");

function guest(overrides: Partial<HuddleGuest> = {}): HuddleGuest {
  return {
    dev_static_pub: "pub-a",
    label: "Ana",
    state: "pending",
    joined_at: 1,
    approved_at: null,
    connected: true,
    ...overrides,
  };
}

function room(guests: HuddleGuest[]): HuddleRoom {
  return {
    id: "room-1",
    token: "tok",
    agent_id: "agent-1",
    device_key: "SIM-1",
    url: "https://example.test/#/huddle/tok",
    created_at: 1,
    expires_at: 2,
    guests,
  };
}

/** Publish what the host would publish. */
function broadcast(rooms: HuddleRoom[]): void {
  act(() => {
    handlers.get("huddle:changed")?.({ hostId: "local", payload: { rooms } });
  });
}

describe("huddle host UI", () => {
  beforeEach(() => {
    handlers.clear();
    approveMock.mockClear();
    denyMock.mockClear();
    setHuddleState({ rooms: [] });
    initHuddleRooms();
  });

  it("asks the host to let a pending guest in, then drops the ask on approval", () => {
    render(<HuddleJoinRequests />);
    expect(screen.queryByText(/wants to join/)).toBeNull();

    broadcast([room([guest()])]);
    expect(screen.getByText("Ana wants to join")).toBeTruthy();

    act(() => {
      screen.getByRole("button", { name: "Allow" }).click();
    });
    expect(approveMock).toHaveBeenCalledWith("room-1", "pub-a");

    // The decision only clears when the host says it did.
    broadcast([room([guest({ state: "approved", approved_at: 9 })])]);
    expect(screen.queryByText("Ana wants to join")).toBeNull();
  });

  it("denies through the same card", () => {
    render(<HuddleJoinRequests />);
    broadcast([room([guest()])]);
    act(() => {
      screen.getByRole("button", { name: "Deny" }).click();
    });
    expect(denyMock).toHaveBeenCalledWith("room-1", "pub-a");
  });

  it("puts one decision on screen per pending guest, with no cap", () => {
    render(<HuddleJoinRequests />);
    broadcast([
      room([
        guest({ dev_static_pub: "a", label: "Ana" }),
        guest({ dev_static_pub: "b", label: "Ben" }),
        guest({ dev_static_pub: "c", label: "Chidi" }),
      ]),
    ]);
    expect(screen.getAllByRole("button", { name: "Allow" })).toHaveLength(3);
    expect(screen.getByText("Chidi wants to join")).toBeTruthy();
  });

  it("marks the agent as shared and counts who is waiting", () => {
    render(<ShareAgentButton agentId="agent-1" sessionId="ws-1" />);
    expect(screen.getByRole("button").textContent).toContain("Share");

    broadcast([
      room([
        guest({ dev_static_pub: "a", label: "Ana" }),
        guest({ dev_static_pub: "b", label: "Ben" }),
      ]),
    ]);
    const button = screen.getByRole("button");
    expect(button.textContent).toContain("Sharing");
    expect(button.textContent).toContain("2");
    expect(button.title).toBe("2 people want to join");
  });

  it("clears the UI when the room ends", () => {
    render(
      <>
        <HuddleJoinRequests />
        <ShareAgentButton agentId="agent-1" sessionId="ws-1" />
      </>,
    );
    broadcast([room([guest()])]);
    expect(screen.getByText("Ana wants to join")).toBeTruthy();

    broadcast([]);
    expect(screen.queryByText("Ana wants to join")).toBeNull();
    expect(screen.getByRole("button").textContent).toContain("Share");
    expect(screen.getByRole("button").title).toBe(
      "Share this agent in a huddle",
    );
  });
});
