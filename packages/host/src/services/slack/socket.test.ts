import type { SlackConnectionState } from "@argus/remote-protocol";
import { describe, expect, it, vi } from "vitest";
import { SlackApiError } from "./api";
import {
  type SocketEnvelope,
  type SocketLike,
  SocketModeClient,
} from "./socket";

class FakeSocket implements SocketLike {
  sent: string[] = [];
  closed = false;
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: ((event: unknown) => void) | null = null;

  constructor(readonly url: string) {}

  send(data: string): void {
    this.sent.push(data);
  }

  close(): void {
    this.closed = true;
  }

  receive(message: object): void {
    this.onmessage?.({ data: JSON.stringify(message) });
  }
}

function setup(openConnection: () => Promise<string>) {
  const sockets: FakeSocket[] = [];
  const envelopes: SocketEnvelope[] = [];
  const states: [SlackConnectionState, string | null][] = [];
  const timers: (() => void)[] = [];
  const client = new SocketModeClient({
    openConnection,
    createSocket: (url) => {
      const socket = new FakeSocket(url);
      sockets.push(socket);

      return socket;
    },
    onEnvelope: (e) => envelopes.push(e),
    onState: (s, e) => states.push([s, e]),
    setTimer: (fn) => timers.push(fn),
    clearTimer: () => undefined,
  });

  return { client, sockets, envelopes, states, timers };
}

const flush = () => new Promise((r) => setTimeout(r, 0));

describe("socketModeClient", () => {
  it("connects, acks every envelope and passes events on", async () => {
    const { client, sockets, envelopes, states } = setup(
      async () => "wss://slack/1",
    );
    client.start();
    await flush();
    const socket = sockets[0]!;
    socket.receive({ type: "hello" });
    expect(states.at(-1)).toEqual(["connected", null]);

    socket.receive({
      type: "events_api",
      envelope_id: "env-1",
      payload: { event: {} },
    });
    expect(socket.sent).toEqual([JSON.stringify({ envelope_id: "env-1" })]);
    expect(envelopes.map((e) => e.envelope_id)).toEqual(["env-1"]);
  });

  it("opens the next connection when Slack asks it to", async () => {
    let n = 0;
    const { client, sockets } = setup(async () => `wss://slack/${++n}`);
    client.start();
    await flush();
    sockets[0]!.receive({ type: "disconnect", reason: "refresh_requested" });
    await flush();

    expect(sockets.map((s) => s.url)).toEqual([
      "wss://slack/1",
      "wss://slack/2",
    ]);
    expect(sockets[0]!.closed).toBe(true);
  });

  it("reconnects with backoff after the socket drops", async () => {
    const open = vi.fn(async () => "wss://slack/x");
    const { client, sockets, timers } = setup(open);
    client.start();
    await flush();
    sockets[0]!.onclose?.();
    expect(timers).toHaveLength(1);
    timers[0]!();
    await flush();

    expect(open).toHaveBeenCalledTimes(2);
    expect(sockets).toHaveLength(2);
  });

  it("gives up on a rejected token instead of retrying", async () => {
    const { client, states, timers } = setup(async () => {
      throw new SlackApiError("apps.connections.open", "invalid_auth");
    });
    client.start();
    await flush();

    expect(states.at(-1)?.[0]).toBe("error");
    expect(timers).toHaveLength(0);
  });

  it("closes the socket on stop", async () => {
    const { client, sockets, states } = setup(async () => "wss://slack/1");
    client.start();
    await flush();
    client.stop();

    expect(sockets[0]!.closed).toBe(true);
    expect(states.at(-1)).toEqual(["off", null]);
  });
});
