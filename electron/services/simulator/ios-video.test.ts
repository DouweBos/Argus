import type { H264Config } from "./h264-parser";
import * as net from "node:net";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { addBroadcastTap } from "../../broadcast";
import { startIosVideoStream, stopIosVideoStream } from "./ios-video";
import { onVideo } from "./videoForward";

const sent = vi.hoisted(() => [] as { channel: string; payload: unknown }[]);

// A fake renderer window, so the local (non-remote) delivery path is asserted
// alongside the broadcast tap.
vi.mock("electron", () => ({
  BrowserWindow: {
    getAllWindows: () => [
      {
        isDestroyed: () => false,
        webContents: {
          send: (channel: string, payload: unknown) => {
            sent.push({ channel, payload });
          },
        },
      },
    ],
  },
}));

const UDID = "TEST-UDID";

// Real 64x64 baseline SPS/PPS (x264), then a stub IDR slice — the parser only
// looks at NAL types, it never decodes slice payloads.
const SPS = [
  0x67, 0x42, 0xc0, 0x0a, 0xd9, 0x04, 0x26, 0xc0, 0x44, 0x00, 0x00, 0x03, 0x00,
  0x04, 0x00, 0x00, 0x03, 0x00, 0x08, 0x3c, 0x48, 0x99, 0x20,
];
const PPS = [0x68, 0xcb, 0x83, 0xcb, 0x20];
const IDR = [0x65, 0x88, 0x84, 0x21];
const START = [0x00, 0x00, 0x00, 0x01];
const STREAM = Buffer.from([
  ...START,
  ...SPS,
  ...START,
  ...PPS,
  ...START,
  ...IDR,
  // Trailing start code: a NAL is only complete once the next one begins.
  ...START,
]);

describe("iOS video on the broadcast bus", () => {
  let server: net.Server;

  beforeEach(() => {
    sent.length = 0;
  });

  afterEach(() => {
    stopIosVideoStream(UDID);
    server.close();
  });

  /** Serve `STREAM` on an ephemeral port and resolve with that port. */
  function serve(): Promise<number> {
    return new Promise((resolve) => {
      server = net.createServer((socket) => {
        socket.write(STREAM);
      });
      server.listen(0, "127.0.0.1", () => {
        resolve((server.address() as net.AddressInfo).port);
      });
    });
  }

  it("delivers config and frames to renderers, taps and videoForward", async () => {
    const tapped: { channel: string; args: unknown[] }[] = [];
    const untap = addBroadcastTap((channel, args) => {
      tapped.push({ channel, args });
    });
    const forwarded: { config?: H264Config; frames: number } = { frames: 0 };
    const done = new Promise<void>((resolve) => {
      onVideo(UDID, {
        onConfig: (config) => {
          forwarded.config = config;
        },
        onFrame: () => {
          forwarded.frames++;
          resolve();
        },
      });
    });

    const port = await serve();
    startIosVideoStream(UDID, port);
    await done;
    untap();

    expect(forwarded.config?.codedWidth).toBe(64);
    expect(forwarded.frames).toBe(1);

    // The local renderer path is unchanged: config first, then the frame.
    const channels = sent.map((e) => e.channel);
    expect(channels[0]).toBe(`ios_video_config:${UDID}`);
    expect(channels.at(-1)).toBe(`ios_video_frame:${UDID}`);
    // ...and a registered tap now sees exactly the same events.
    expect(tapped.map((e) => e.channel)).toEqual(channels);
    const frame = tapped.at(-1)?.args[0] as { keyFrame: boolean };
    expect(frame.keyFrame).toBe(true);
  });
});
