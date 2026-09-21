import type { PairedDevice } from "./deviceStore";
import type { Envelope } from "@argus/remote-protocol";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { generateKeypair, NoiseHandshake, type NoiseSession } from "./noise";

vi.mock("../../state", () => ({
  appState: {
    agents: new Map(),
    agentSnapshots: new Map(),
    agentPendingPermissions: new Map(),
  },
}));
vi.mock("../mcp/projectDiscovery", () => ({
  collectAllProjects: vi.fn(() => []),
}));

const { DeviceConnection } = await import("./gateway");
const { emitBrowserFrame, resetBrowserFrames } =
  await import("../browser/frameForward");
const { resetClaims } = await import("./deviceClaims");
const { defineCommand } = await import("../command/registry");

const enc = new TextEncoder();
const dec = new TextDecoder();
const TAG_JSON = 0x00;
const TAG_MEDIA = 0x01;
const MEDIA_JPEG = 2;

const device: PairedDevice = {
  device_id: "mac-1",
  label: "Studio",
  dev_static_pub: "",
  capabilities: ["admin"],
  created_at: 0,
  last_seen: null,
};

const clicks: string[] = [];
for (const name of ["browser_mouse_event", "browser_view_navigate"]) {
  defineCommand(name, {
    tier: "admin",
    handler: (args) => {
      clicks.push(String(args.sessionId));

      return null;
    },
  });
}

interface Client {
  conn: InstanceType<typeof DeviceConnection>;
  media: { streamId: number; data: Uint8Array }[];
  responses: Envelope[];
  send: (env: Record<string, unknown>) => Promise<void>;
}

/** A paired client wired to its own gateway connection over a real Noise pair. */
function connect(label: string): Client {
  const client = generateKeypair();
  const host = generateKeypair();
  const ci = new NoiseHandshake({
    role: "initiator",
    staticKey: client,
    remoteStatic: host.pub,
  });
  const ri = new NoiseHandshake({ role: "responder", staticKey: host });
  ri.readMessage(ci.writeMessage(new Uint8Array(0)));
  ci.readMessage(ri.writeMessage(new Uint8Array(0)));
  const clientSession: NoiseSession = ci.session();

  const responses: Envelope[] = [];
  const media: { streamId: number; data: Uint8Array }[] = [];
  const conn = new DeviceConnection(
    { ...device, device_id: label, label },
    ri.session(),
    (bytes) => {
      const plain = clientSession.decrypt(bytes);
      if (plain[0] === TAG_MEDIA) {
        const body = plain.subarray(1);
        const view = new DataView(
          body.buffer,
          body.byteOffset,
          body.byteLength,
        );
        expect(view.getUint8(0)).toBe(MEDIA_JPEG);
        media.push({
          streamId: view.getUint16(2, true),
          data: body.slice(12),
        });

        return;
      }
      responses.push(JSON.parse(dec.decode(plain.subarray(1))) as Envelope);
    },
  );

  let seq = 0;
  const send = async (env: Record<string, unknown>) => {
    const json = enc.encode(JSON.stringify({ seq: seq++, ...env }));
    const plain = new Uint8Array(1 + json.length);
    plain[0] = TAG_JSON;
    plain.set(json, 1);
    await conn.onFrame(clientSession.encrypt(plain));
  };

  return { conn, media, responses, send };
}

const okOf = <T>(env: Envelope): T => (env as unknown as { ok: T }).ok;
const errOf = (env: Envelope) =>
  (env as unknown as { error?: { code: string; message: string } }).error;

describe("embedded browser frames over the gateway", () => {
  beforeEach(() => {
    resetBrowserFrames();
    resetClaims();
    clicks.length = 0;
  });

  it("delivers frames for a watched session on the media channel", async () => {
    const c = connect("mac-a");
    await c.send({
      type: "req",
      id: "1",
      method: "browser.watch",
      params: { session_id: "s1" },
    });
    const { stream_id } = okOf<{ stream_id: number }>(c.responses[0]);
    expect(stream_id).toBeGreaterThan(0);

    emitBrowserFrame("s1", new Uint8Array([0xff, 0xd8, 0xff]));
    expect(c.media).toEqual([
      { streamId: stream_id, data: new Uint8Array([0xff, 0xd8, 0xff]) },
    ]);
  });

  it("gives a late watcher the last frame so a static page still paints", async () => {
    emitBrowserFrame("s1", new Uint8Array([1, 2, 3]));
    const c = connect("mac-a");
    await c.send({
      type: "req",
      id: "1",
      method: "browser.watch",
      params: { session_id: "s1" },
    });
    expect(c.media).toHaveLength(1);
  });

  it("keeps two sessions' frames apart", async () => {
    const c = connect("mac-a");
    await c.send({
      type: "req",
      id: "1",
      method: "browser.watch",
      params: { session_id: "s1" },
    });
    emitBrowserFrame("s2", new Uint8Array([9]));
    expect(c.media).toHaveLength(0);
  });

  it("stops sending after unwatch, and after the connection goes away", async () => {
    const c = connect("mac-a");
    await c.send({
      type: "req",
      id: "1",
      method: "browser.watch",
      params: { session_id: "s1" },
    });
    await c.send({
      type: "req",
      id: "2",
      method: "browser.unwatch",
      params: { session_id: "s1" },
    });
    emitBrowserFrame("s1", new Uint8Array([1]));
    expect(c.media).toHaveLength(0);

    const other = connect("mac-b");
    await other.send({
      type: "req",
      id: "1",
      method: "browser.watch",
      params: { session_id: "s1" },
    });
    other.conn.dispose();
    emitBrowserFrame("s1", new Uint8Array([2]));
    expect(other.media).toHaveLength(1); // only the cached frame at watch time
  });

  it("fans one session out to both attached desktops", async () => {
    const a = connect("mac-a");
    const b = connect("mac-b");
    for (const c of [a, b]) {
      await c.send({
        type: "req",
        id: "1",
        method: "browser.watch",
        params: { session_id: "s1" },
      });
    }
    emitBrowserFrame("s1", new Uint8Array([7]));
    expect(a.media).toHaveLength(1);
    expect(b.media).toHaveLength(1);
  });
});

describe("embedded browser input arbitration", () => {
  beforeEach(() => {
    resetBrowserFrames();
    resetClaims();
    clicks.length = 0;
  });

  const click = (c: Client, id: string, sessionId: string) =>
    c.send({
      type: "req",
      id,
      method: "browser_mouse_event",
      params: { sessionId, type: "click", x: 1, y: 2 },
    });

  it("lets the first client drive and refuses the second", async () => {
    const a = connect("mac-a");
    const b = connect("mac-b");
    await click(a, "1", "s1");
    await click(b, "1", "s1");

    expect(errOf(a.responses[0])).toBeUndefined();
    expect(errOf(b.responses[0])?.code).toBe("capability_denied");
    expect(clicks).toEqual(["s1"]);
  });

  it("does not let one session's claim block another", async () => {
    const a = connect("mac-a");
    const b = connect("mac-b");
    await click(a, "1", "s1");
    await click(b, "1", "s2");
    expect(errOf(b.responses[0])).toBeUndefined();
    expect(clicks).toEqual(["s1", "s2"]);
  });

  it("frees the browser once the holder stops watching", async () => {
    const a = connect("mac-a");
    const b = connect("mac-b");
    await click(a, "1", "s1");
    await a.send({
      type: "req",
      id: "2",
      method: "browser.unwatch",
      params: { session_id: "s1" },
    });
    await click(b, "1", "s1");
    expect(errOf(b.responses[0])).toBeUndefined();
  });

  it("frees the browser when the holder disconnects", async () => {
    const a = connect("mac-a");
    const b = connect("mac-b");
    await click(a, "1", "s1");
    a.conn.dispose();
    await click(b, "1", "s1");
    expect(errOf(b.responses[0])).toBeUndefined();
  });

  it("arbitrates navigation too — it changes what every viewer sees", async () => {
    const a = connect("mac-a");
    const b = connect("mac-b");
    await click(a, "1", "s1");
    await b.send({
      type: "req",
      id: "1",
      method: "browser_view_navigate",
      params: { sessionId: "s1", url: "https://example.com" },
    });
    expect(errOf(b.responses[0])?.code).toBe("capability_denied");
  });
});
