import type { ServeSimEndpoint } from "./ids";
import type { H264Config } from "../../simulator/h264-parser";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  MediaStreamTrack,
  RTCPeerConnection,
  RtpHeader,
  RtpPacket,
} from "werift";
import { WebSocketServer } from "ws";
import { lengthPrefixed } from "../../simulator/accessUnits";
import { packetizeH264 } from "../../simulator/h264Rtp";
import { h264PeerConfig } from "../../simulator/webrtcVideo";
import { openServeSimVideo } from "./serveSim";
import { ServeSimInput } from "./serveSimInput";
import { rotationFor } from "./source";

vi.mock("../../telemetry/telemetry", () => ({ capture: () => {} }));

const TOKEN = "serve-sim-token-0123";
const SPS = Uint8Array.from([
  0x67, 0x42, 0xc0, 0x0a, 0xda, 0x0f, 0x0a, 0x68, 0x40, 0x00, 0x00, 0x03, 0x00,
  0x40, 0x00, 0x00, 0x0f, 0x03, 0xc4, 0x89, 0xa8,
]);
const PPS = Uint8Array.from([0x68, 0xce, 0x06, 0xe2]);
const IDR = Uint8Array.from([0x65, 1, 2, 3, 4]);
const DELTA = Uint8Array.from([0x41, 9, 9]);

function avcC(): Uint8Array {
  const out = new Uint8Array(11 + SPS.length + PPS.length);
  out.set([1, SPS[1], SPS[2], SPS[3], 0xff, 0xe1, 0, SPS.length]);
  out.set(SPS, 8);
  out.set([1, 0, PPS.length], 8 + SPS.length);
  out.set(PPS, 11 + SPS.length);

  return out;
}

function envelope(tag: number, payload: Uint8Array): Buffer {
  const head = Buffer.alloc(5);
  head.writeUInt32BE(payload.length + 1);
  head[4] = tag;

  return Buffer.concat([head, payload]);
}

interface FakeServeSim {
  ep: ServeSimEndpoint;
  server: http.Server;
  /** Answers WebRTC offers with this peer, which sends H.264. */
  webrtc: boolean;
  inputs: { tag: number; body: unknown }[];
  offers: { codec: string; sessionId: string }[];
  wsProtocols: string[];
  closes: number;
  peer: RTCPeerConnection | null;
  track: MediaStreamTrack | null;
}

const cleanups: (() => unknown)[] = [];

async function cleanUp() {
  for (const c of cleanups.splice(0).reverse()) {
    await c();
  }
}

async function fakeServeSim(webrtc: boolean): Promise<FakeServeSim> {
  const fake: FakeServeSim = {
    ep: { origin: "", token: TOKEN, udid: "SIM-1" },
    server: undefined as unknown as http.Server,
    webrtc,
    inputs: [],
    offers: [],
    wsProtocols: [],
    closes: 0,
    peer: null,
    track: null,
  };
  const server = http.createServer((req, res) => {
    if (req.headers.authorization !== `Bearer ${TOKEN}`) {
      res.writeHead(401).end();

      return;
    }
    const url = new URL(req.url ?? "/", "http://x");
    if (url.pathname === "/helper/SIM-1/stream.avcc") {
      if (fake.webrtc) {
        res.writeHead(409, { "content-type": "application/json" });
        res.end(
          JSON.stringify({
            error: "stream_transport_locked",
            transport: "webrtc",
          }),
        );

        return;
      }
      res.writeHead(200);
      res.write(envelope(1, avcC()));
      res.write(envelope(2, lengthPrefixed([IDR])));
      // Split a frame across writes.
      const d = envelope(3, lengthPrefixed([DELTA]));
      res.write(d.subarray(0, 3));
      setTimeout(() => res.write(d.subarray(3)), 20);

      return;
    }
    if (url.pathname === "/helper/SIM-1/stream.mjpeg") {
      res.writeHead(409).end();

      return;
    }
    if (url.pathname === "/api") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          device: "SIM-1",
          streamSettings: { transport: "webrtc", iceServers: [] },
        }),
      );

      return;
    }
    if (
      url.pathname === "/helper/SIM-1/webrtc/offer" &&
      req.method === "POST"
    ) {
      let body = "";
      req.on("data", (c: Buffer) => (body += c.toString()));
      req.on("end", () => {
        (async () => {
          const offer = JSON.parse(body) as {
            sdp: string;
            sessionId: string;
            codec: string;
          };
          fake.offers.push(offer);
          const peer = new RTCPeerConnection({
            ...h264PeerConfig({}),
            iceAdditionalHostAddresses: ["127.0.0.1"],
            iceUseIpv6: false,
            iceInterfaceAddresses: { udp4: "127.0.0.1" },
          });
          const track = new MediaStreamTrack({ kind: "video" });
          peer.addTransceiver(track, { direction: "sendonly" });
          fake.peer = peer;
          fake.track = track;
          cleanups.push(() => peer.close());
          await peer.setRemoteDescription({ type: "offer", sdp: offer.sdp });
          await peer.setLocalDescription(await peer.createAnswer());
          if (peer.iceGatheringState !== "complete") {
            await new Promise<void>((r) =>
              peer.iceGatheringStateChange.subscribe(
                (s) => s === "complete" && r(),
              ),
            );
          }
          res.writeHead(200, { "content-type": "application/json" });
          res.end(
            JSON.stringify({ type: "answer", sdp: peer.localDescription?.sdp }),
          );
        })().catch(() => undefined);
      });

      return;
    }
    if (url.pathname === "/helper/SIM-1/webrtc/close") {
      fake.closes++;
      res.writeHead(200).end();

      return;
    }
    res.writeHead(404).end();
  });
  const wss = new WebSocketServer({
    server,
    handleProtocols: (protocols) => {
      fake.wsProtocols = [...protocols];

      return protocols.values().next().value ?? false;
    },
  });
  wss.on("connection", (ws, req) => {
    if (
      req.headers.authorization !== `Bearer ${TOKEN}` ||
      !req.url?.includes("device=SIM-1")
    ) {
      ws.close(1008);

      return;
    }
    ws.send(
      Buffer.concat([
        Buffer.of(0x82),
        Buffer.from(
          JSON.stringify({
            width: 1179,
            height: 2556,
            orientation: "portrait",
          }),
        ),
      ]),
    );
    ws.send(Buffer.of(0x83));
    ws.on("message", (data: Buffer) => {
      fake.inputs.push({
        tag: data[0],
        body: JSON.parse(data.subarray(1).toString()),
      });
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  fake.server = server;
  fake.ep.origin = `http://127.0.0.1:${String((server.address() as AddressInfo).port)}`;
  cleanups.push(() => {
    for (const client of wss.clients) {
      client.terminate();
    }
    wss.close();
    server.closeAllConnections();

    return new Promise((r) => server.close(r));
  });

  return fake;
}

function collect() {
  const configs: H264Config[] = [];
  const frames: { data: Uint8Array; key: boolean }[] = [];

  return {
    configs,
    frames,
    sink: {
      onConfig: (c: H264Config) => configs.push(c),
      onFrame: (data: Uint8Array, key: boolean) => frames.push({ data, key }),
    },
  };
}

describe("serve-sim video", () => {
  afterEach(cleanUp);

  it("reads AVCC envelopes into access units", async () => {
    const fake = await fakeServeSim(false);
    const out = collect();
    const stream = openServeSimVideo(() => fake.ep, out.sink);
    cleanups.push(() => stream.close());
    await vi.waitFor(() => expect(out.frames).toHaveLength(2));
    expect(out.configs[0]).toMatchObject({
      codec: "avc1.42c00a",
      codedWidth: 240,
      codedHeight: 320,
    });
    expect(out.frames[0].key).toBe(true);
    expect(out.frames[0].data).toEqual(lengthPrefixed([IDR]));
    expect(out.frames[1]).toEqual({
      data: lengthPrefixed([DELTA]),
      key: false,
    });
  });

  it("switches to host-side WebRTC on a 409 and releases the capture on close", async () => {
    const fake = await fakeServeSim(true);
    const out = collect();
    const stream = openServeSimVideo(() => fake.ep, out.sink);
    await vi.waitFor(
      () => expect(fake.peer?.connectionState).toBe("connected"),
      { timeout: 15_000 },
    );
    let seq = 1;
    let ts = 0;
    const deadline = Date.now() + 8_000;
    while (out.frames.length < 2 && Date.now() < deadline) {
      ts += 3000;
      for (const p of packetizeH264(
        out.frames.length === 0 ? [SPS, PPS, IDR] : [DELTA],
      )) {
        fake.track?.writeRtp(
          new RtpPacket(
            new RtpHeader({
              sequenceNumber: seq++,
              timestamp: ts,
              marker: p.marker,
              payloadType: 96,
            }),
            Buffer.from(p.payload),
          ),
        );
      }
      await new Promise((r) => setTimeout(r, 100));
    }
    expect(out.frames[0].key).toBe(true);
    expect(out.configs[0].codec).toBe("avc1.42c00a");
    expect(fake.offers[0].codec).toBe("h264");
    expect(fake.offers[0].sessionId).toMatch(/^[0-9a-f-]{36}$/);
    stream.close();
    await vi.waitFor(() => expect(fake.closes).toBe(1));
  }, 30_000);
});

describe("serve-sim input", () => {
  afterEach(cleanUp);

  it("speaks the tagged protocol with the token kept server-side", async () => {
    const fake = await fakeServeSim(false);
    const input = new ServeSimInput(() => fake.ep);
    cleanups.push(() => input.close());
    await input.touch(0.25, 0.5, 0);
    await input.touch(0.3, 0.5, 1);
    await input.touch(0.3, 0.5, 2);
    await input.button("ios_home");
    await input.key(0x04, true);
    await expect(input.button("ios_siri")).rejects.toMatch(/isn't available/);
    await vi.waitFor(() => expect(fake.inputs).toHaveLength(5));
    expect(fake.inputs).toEqual([
      { tag: 0x03, body: { type: "begin", x: 0.25, y: 0.5 } },
      { tag: 0x03, body: { type: "move", x: 0.3, y: 0.5 } },
      { tag: 0x03, body: { type: "end", x: 0.3, y: 0.5 } },
      { tag: 0x04, body: { button: "home" } },
      { tag: 0x06, body: { type: "down", usage: 0x04 } },
    ]);
    expect(fake.wsProtocols).toEqual([`serve-sim.token.${TOKEN}`]);
    expect(input.screen).toEqual({
      width: 1179,
      height: 2556,
      orientation: "portrait",
    });
  });
});

describe("serve-sim display", () => {
  it("turns a sideways framebuffer upright the way serve-sim's input expects", () => {
    const portrait = { width: 1179, height: 2556 };
    expect(rotationFor(null)).toBe(0);
    expect(rotationFor({ ...portrait, orientation: "portrait" })).toBe(0);
    expect(rotationFor({ ...portrait, orientation: "landscape_left" })).toBe(
      90,
    );
    expect(rotationFor({ ...portrait, orientation: "landscape_right" })).toBe(
      270,
    );
    expect(
      rotationFor({ ...portrait, orientation: "portrait_upside_down" }),
    ).toBe(180);
    // Already landscape-shaped: upright as it comes.
    expect(
      rotationFor({ width: 2556, height: 1179, orientation: "landscape_left" }),
    ).toBe(0);
  });
});
