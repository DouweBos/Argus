import type { SocketLike } from "./socket";
import { describe, expect, it, vi } from "vitest";
import { SlackBot } from "./bot";
import { fakeSlack, mention } from "./slack.testkit";
import { SocketModeClient } from "./socket";

vi.mock("@argus/host/logger", () => ({ warn: vi.fn(), info: vi.fn() }));

describe("slack socket to bot", () => {
  it("acks a mention off the socket and starts an agent in the mapped project", async () => {
    const slack = fakeSlack(vi.fn, {
      mappings: [
        { channel_id: "CWEB", channel_name: "web", repo_root: "/work/web" },
      ],
    });
    const bot = new SlackBot(slack.deps);
    const sent: string[] = [];
    const socket: SocketLike = {
      send: (data) => sent.push(data),
      close: () => undefined,
      onopen: null,
      onmessage: null,
      onclose: null,
      onerror: null,
    };
    let handled: Promise<void> = Promise.resolve();
    const client = new SocketModeClient({
      openConnection: async () => "wss://slack.test/socket",
      createSocket: () => socket,
      onEnvelope: (envelope) => {
        handled = bot.handleEnvelope(envelope);
      },
      onState: () => undefined,
    });
    client.start();
    await new Promise((r) => setTimeout(r, 0));

    socket.onmessage?.({ data: JSON.stringify(mention("ship the footer")) });
    await handled;

    expect(sent).toEqual([JSON.stringify({ envelope_id: "e1" })]);
    expect(slack.started).toEqual([
      { repoRoot: "/work/web", prompt: "ship the footer", images: 0 },
    ]);
    client.stop();
  });
});
