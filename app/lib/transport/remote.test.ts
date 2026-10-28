import { beforeEach, describe, expect, it, vi } from "vitest";

const requests: { method: string; params: unknown }[] = [];
const subscriptions: { agentId: string; on: boolean }[] = [];
type EventHandler = (env: {
  event: string;
  payload: unknown;
  seq: number;
  type: "evt";
}) => void;

let capturedOnEvent: EventHandler | null;

// Only the socket is faked — MediaRouter and the frame parser are the real
// ones, so this exercises the actual fan-out.
vi.mock("@argus/remote-client", async (importOriginal) => ({
  ...((await importOriginal()) as Record<string, unknown>),
  Transport: class {
    constructor(
      _credentials: unknown,
      private readonly handlers: {
        onEvent: (env: never) => void;
        onState: (state: string) => void;
      },
    ) {
      capturedOnEvent = handlers.onEvent as EventHandler;
    }
    // The fake gateway answers at once, so every test starts connected.
    connect() {
      this.handlers.onState("ready");
    }
    disconnect() {}
    request(method: string, params: unknown) {
      if (method === "host.endpoints") {
        return Promise.resolve({ endpoints: [] });
      }
      requests.push({ method, params });

      return Promise.resolve("ok");
    }
    subscribe(agentId: string, on: boolean) {
      subscriptions.push({ agentId, on });
    }
  },
}));

const localInvoke = vi.fn().mockResolvedValue("local");
const localSend = vi.fn();

vi.stubGlobal("window", {
  argus: { invoke: localInvoke, send: localSend, on: vi.fn() },
});

const { RemoteTransport } = await import("./remote");

const host = {
  id: "d1",
  label: "Mac mini",
  url: "ws://mini",
  devPrivB64: "",
  devPubB64: "",
  hostPubB64: "",
  capabilities: ["admin"],
  pairedAt: 0,
};

function makeTransport() {
  const transport = new RemoteTransport(host, { onState: () => undefined });
  transport.connect();

  return transport;
}

describe("remoteTransport", () => {
  beforeEach(() => {
    requests.length = 0;
    subscriptions.length = 0;
    localInvoke.mockClear();
  });

  it("sends the raw IPC channel name as the wire method", async () => {
    await makeTransport().invoke("start_agent", { sessionId: "s1" });
    expect(requests).toEqual([
      { method: "start_agent", params: { sessionId: "s1" } },
    ]);
  });

  it("runs client-executed commands here instead", async () => {
    await makeTransport().invoke("open_external_url", { url: "https://x" });
    expect(requests).toHaveLength(0);
    expect(localInvoke).toHaveBeenCalledWith("open_external_url", {
      url: "https://x",
    });
  });

  it("rejects commands that would act on the wrong machine", async () => {
    await expect(
      makeTransport().invoke("reveal_in_finder", { path: "/tmp" }),
    ).rejects.toThrow(/reveal_in_finder/);
    expect(requests).toHaveLength(0);
  });

  it("delivers forwarded broadcasts on their original channel", () => {
    const transport = makeTransport();
    const seen: unknown[] = [];
    transport.on("session:created", (payload) => seen.push(payload));
    capturedOnEvent?.({
      type: "evt",
      seq: 1,
      event: "ipc",
      payload: { channel: "session:created", args: [{ id: "s1" }] },
    });
    expect(seen).toEqual([{ id: "s1" }]);
  });

  it("scopes terminal streams so an unwatched PTY is never sent", () => {
    const transport = makeTransport();
    const off = transport.on("terminal:data:t1", () => undefined);
    const offExit = transport.on("terminal:exit:t1", () => undefined);
    expect(subscriptions).toEqual([{ agentId: "terminal:t1", on: true }]);
    off();
    offExit();
    expect(subscriptions).toEqual([
      { agentId: "terminal:t1", on: true },
      { agentId: "terminal:t1", on: false },
    ]);
  });

  it("does not subscribe for unscoped channels", () => {
    makeTransport().on("session:created", () => undefined);
    expect(subscriptions).toHaveLength(0);
  });

  it("subscribes once per agent and releases on the last listener", () => {
    const transport = makeTransport();
    const offA = transport.on("agent:event:a1", () => undefined);
    const offB = transport.on("agent:status:a1", () => undefined);
    expect(subscriptions).toEqual([{ agentId: "a1", on: true }]);
    offA();
    expect(subscriptions).toHaveLength(1);
    offB();
    expect(subscriptions).toEqual([
      { agentId: "a1", on: true },
      { agentId: "a1", on: false },
    ]);
  });
});

/** A minimal TAG_MEDIA frame body for `streamId`, as the host builds it. */
function frameBody(streamId: number): Uint8Array {
  const bytes = new Uint8Array(13);
  new DataView(bytes.buffer).setUint16(2, streamId, true);
  bytes[0] = 1;

  return bytes;
}

describe("remote media", () => {
  it("fans binary frames out to the stream's sink", () => {
    const transport = makeTransport();
    const frames: unknown[] = [];
    transport.media.register(7, (msg) => frames.push(msg));
    transport.media.push(frameBody(7));
    expect(frames).toHaveLength(1);
  });

  it("parses the browser's JPEG frames off the same channel", () => {
    const transport = makeTransport();
    const frames: { data?: Uint8Array; kind: string }[] = [];
    transport.media.register(9, (msg) => frames.push(msg));
    const bytes = new Uint8Array(14);
    bytes[0] = 2; // MEDIA_JPEG
    new DataView(bytes.buffer).setUint16(2, 9, true);
    bytes.set([0xff, 0xd8], 12);
    transport.media.push(bytes);
    expect(frames).toEqual([
      {
        kind: "jpeg",
        streamId: 9,
        timestamp: 0,
        data: new Uint8Array([0xff, 0xd8]),
      },
    ]);
  });

  it("drops stream ids when the socket goes away", () => {
    const transport = makeTransport();
    const frames: unknown[] = [];
    transport.media.register(7, (msg) => frames.push(msg));
    transport.disconnect();
    // Stream ids belong to one socket; the panel re-watches and gets new ones.
    transport.media.push(frameBody(7));
    expect(frames).toHaveLength(0);
  });
});
