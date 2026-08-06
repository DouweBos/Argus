import type { InputCapabilities, WebSocketLike } from "./deviceInputClient";
import { describe, expect, it } from "vitest";
import { DeviceInputClient } from "./deviceInputClient";

const CAPS: InputCapabilities = {
  touch: true,
  drag: true,
  multitouch: true,
  buttons: ["home", "lock"],
  keyboard: true,
  text: true,
  tvRemote: false,
  springboard: true,
  liveDrag: "buffered",
  binaryPointer: false,
  coord: "normalized",
};

class FakeSocket implements WebSocketLike {
  readyState = 1; // OPEN
  bufferedAmount = 0;
  sent: string[] = [];
  onopen: ((ev: unknown) => void) | null = null;
  onclose: ((ev: unknown) => void) | null = null;
  onmessage: ((ev: { data: unknown }) => void) | null = null;
  onerror: ((ev: unknown) => void) | null = null;

  send(data: string): void {
    this.sent.push(data);
  }
  close(): void {
    this.readyState = 3;
    this.onclose?.({});
  }
  hello(): void {
    this.onmessage?.({
      data: JSON.stringify({
        t: "hello",
        protocol: 1,
        device: "d",
        platform: "ios",
        capabilities: CAPS,
      }),
    });
  }
  frames(): Record<string, unknown>[] {
    return this.sent.map((s) => JSON.parse(s) as Record<string, unknown>);
  }
}

function connected(): { client: DeviceInputClient; sock: FakeSocket } {
  const sock = new FakeSocket();
  const client = new DeviceInputClient("ws://x/input", {
    createSocket: () => sock,
  });
  client.connect();

  return { client, sock };
}

describe("deviceInputClient", () => {
  it("stays inert until the hello handshake completes", () => {
    const { client, sock } = connected();
    client.pointer(0, "down", 0.1, 0.1);
    expect(sock.sent).toHaveLength(0);
    expect(client.ready).toBe(false);
  });

  it("replies select on hello and becomes ready with capabilities", () => {
    const { client, sock } = connected();
    sock.hello();
    expect(client.ready).toBe(true);
    expect(client.capabilities?.buttons).toEqual(["home", "lock"]);
    const select = sock.frames()[0];
    expect(select.t).toBe("select");
    expect(select).toMatchObject({ protocol: 1, coalesce: { pointerHz: 120 } });
  });

  it("streams pointer frames with monotonic seq and normalized coords", () => {
    const { client, sock } = connected();
    sock.hello();
    client.pointer(0, "down", 0.5, 0.5);
    client.pointer(0, "move", 0.6, 0.6);
    client.pointer(0, "up", 0.6, 0.6);
    const p = sock.frames().slice(1); // skip select
    expect(p.map((f) => f.phase)).toEqual(["down", "move", "up"]);
    expect(p.map((f) => f.seq)).toEqual([0, 1, 2]);
    expect(p[0]).toMatchObject({ t: "pointer", id: 0, x: 0.5, y: 0.5 });
  });

  it("drops intermediate moves under backpressure but never a phase transition", () => {
    const { client, sock } = connected();
    sock.hello();
    sock.bufferedAmount = 40_000;
    const before = sock.sent.length;
    client.pointer(0, "move", 0.7, 0.7); // coalesced away
    expect(sock.sent).toHaveLength(before);
    client.pointer(0, "up", 0.7, 0.7); // lossless
    expect(sock.sent).toHaveLength(before + 1);
    expect(sock.frames().at(-1)).toMatchObject({ phase: "up" });
  });

  it("goes not-ready on close", () => {
    const { client, sock } = connected();
    sock.hello();
    expect(client.ready).toBe(true);
    client.close();
    expect(client.ready).toBe(false);
  });
});
