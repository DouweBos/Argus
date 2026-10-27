import type { H264Config } from "./h264-parser";
import { describe, expect, it, vi } from "vitest";
import { watchRemoteVideo } from "./remoteVideo";
import { clearVideo, emitVideoConfig, emitVideoFrame } from "./videoForward";

const captured = vi.hoisted(() => [] as unknown[]);
vi.mock("../telemetry/telemetry", () => ({
  capture: (...args: unknown[]) => captured.push(args),
}));
vi.mock("./iosCapture", () => ({ captureSessionFor: () => null }));

const CONFIG: H264Config = {
  codec: "avc1.4d0028",
  codedWidth: 640,
  codedHeight: 1280,
  description: new Uint8Array([1]),
};

function viewer(buffered = 0) {
  const got = { configs: 0, frames: [] as boolean[], buffered };

  return {
    got,
    v: {
      onConfig: () => {
        got.configs += 1;
      },
      onFrame: (_d: Uint8Array, keyFrame: boolean) => {
        got.frames.push(keyFrame);
      },
      buffered: () => got.buffered,
    },
  };
}

describe("watchRemoteVideo on the shared stream", () => {
  it("fans out config and frames, and replays config to late joiners", () => {
    const a = viewer();
    const stopA = watchRemoteVideo("emu-1", "android", a.v);
    emitVideoConfig("emu-1", CONFIG);
    emitVideoFrame("emu-1", new Uint8Array(10), true, 0);
    const b = viewer();
    const stopB = watchRemoteVideo("emu-1", "android", b.v);
    emitVideoFrame("emu-1", new Uint8Array(10), false, 1);
    expect(a.got).toMatchObject({ configs: 1, frames: [true, false] });
    expect(b.got).toMatchObject({ configs: 1, frames: [false] });
    stopA();
    stopB();
    clearVideo("emu-1");
  });

  it("sheds deltas, never keyframes, for a backed-up viewer only", () => {
    const slow = viewer(2_000_000);
    const fast = viewer();
    const stopSlow = watchRemoteVideo("emu-2", "android", slow.v);
    const stopFast = watchRemoteVideo("emu-2", "android", fast.v);
    emitVideoFrame("emu-2", new Uint8Array(10), true, 0);
    emitVideoFrame("emu-2", new Uint8Array(10), false, 1);
    expect(slow.got.frames).toEqual([true]);
    expect(fast.got.frames).toEqual([true, false]);
    stopSlow();
    stopFast();
  });

  it("falls back to the shared stream when iOS has no bridge, and reports the session", async () => {
    captured.length = 0;
    const a = viewer();
    const stop = watchRemoteVideo("sim-1", "ios", a.v);
    await Promise.resolve();
    emitVideoFrame("sim-1", new Uint8Array(10), true, 0);
    expect(a.got.frames).toEqual([true]);
    stop();
    expect(captured).toEqual([
      [
        "simulator_remote_stream_ended",
        expect.objectContaining({ adaptive: false, platform: "ios" }),
      ],
    ]);
  });
});
