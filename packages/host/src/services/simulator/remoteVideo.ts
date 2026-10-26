/**
 * Device video for remote viewers (the phone, a remote Mac, the web client).
 *
 * Local viewers keep the bridge's uncapped stream. Remote viewers of an iOS
 * simulator share a second, bitrate-capped encode from the same bridge, which
 * runs only while one of them is watching. Every viewer's socket is sampled and
 * {@link RemoteBitrateController} retargets that encode (bitrate, then
 * resolution and fps) for the most congested one.
 *
 * Android capture (scrcpy / ffmpeg) is configured at launch and shared with the
 * local view, so Android remote viewers ride the existing, already-capped
 * stream without adaptation — as does iOS if the remote encode can't start.
 */

import type { H264Config } from "./h264-parser";
import type { RemotePlatform } from "@argus/remote-protocol";
import * as net from "node:net";
import { error, log } from "@argus/host/logger";
import { capture } from "../telemetry/telemetry";
import { H264AccessUnitParser } from "./h264-parser";
import { getBridgeForUdid } from "./ios";
import {
  RemoteBitrateController,
  type StreamTarget,
  type ViewerSample,
} from "./remoteBitrate";
import { onVideo } from "./videoForward";

/** Shed delta frames once a viewer's socket queues more than this (bytes). */
const BACKPRESSURE_LIMIT = 1_000_000;
const SAMPLE_INTERVAL_MS = 500;

export interface RemoteVideoViewer {
  onConfig: (config: H264Config) => void;
  onFrame: (data: Uint8Array, keyFrame: boolean, timestamp: number) => void;
  /** Bytes queued on the viewer's socket right now. */
  buffered: () => number;
}

interface ViewerState {
  viewer: RemoteVideoViewer;
  sentBytes: number;
  dropped: number;
}

interface RemoteStream {
  deviceId: string;
  platform: RemotePlatform;
  viewers: Map<string, ViewerState>;
  /** Null while the stream rides the shared local encode. */
  controller: RemoteBitrateController | null;
  lastConfig: H264Config | null;
  /** Tears down whatever currently feeds the stream. */
  detachSource: () => void;
  timer: ReturnType<typeof setInterval> | null;
  startedAt: number;
  closed: boolean;
}

const streams = new Map<string, RemoteStream>();
let nextViewerId = 1;

/**
 * Subscribe a remote viewer to a device's stream. The device's capture must
 * already be held (the gateway acquires it first). Returns an unsubscribe.
 */
export function watchRemoteVideo(
  deviceId: string,
  platform: RemotePlatform,
  viewer: RemoteVideoViewer,
): () => void {
  let stream = streams.get(deviceId);
  if (!stream) {
    stream = openStream(deviceId, platform);
    streams.set(deviceId, stream);
  }
  const id = String(nextViewerId++);
  stream.viewers.set(id, { viewer, sentBytes: 0, dropped: 0 });
  if (stream.lastConfig) {
    viewer.onConfig(stream.lastConfig);
  }

  const owner = stream;

  return () => {
    owner.viewers.delete(id);
    owner.controller?.forget(id);
    if (owner.viewers.size === 0) {
      closeStream(owner);
    }
  };
}

function openStream(deviceId: string, platform: RemotePlatform): RemoteStream {
  const stream: RemoteStream = {
    deviceId,
    platform,
    viewers: new Map(),
    controller: null,
    lastConfig: null,
    detachSource: () => {},
    timer: null,
    startedAt: Date.now(),
    closed: false,
  };
  if (platform === "ios") {
    startAdaptive(stream).catch((err: unknown) => {
      error(`[RemoteVideo] adaptive stream failed (${deviceId}):`, err);
      useSharedStream(stream);
    });
  } else {
    useSharedStream(stream);
  }

  return stream;
}

/** Fan a config out to every viewer; cached for late joiners. */
function emitConfig(stream: RemoteStream, config: H264Config): void {
  stream.lastConfig = config;
  for (const v of stream.viewers.values()) {
    v.viewer.onConfig(config);
  }
}

/** Fan a frame out, shedding deltas for viewers whose socket is backed up. */
function emitFrame(
  stream: RemoteStream,
  data: Uint8Array,
  keyFrame: boolean,
  timestamp: number,
): void {
  for (const v of stream.viewers.values()) {
    if (!keyFrame && v.viewer.buffered() > BACKPRESSURE_LIMIT) {
      v.dropped += 1;
      continue;
    }
    v.viewer.onFrame(data, keyFrame, timestamp);
    v.sentBytes += data.length;
  }
}

/** Ride the shared local encode: Android, or iOS when the remote one failed. */
function useSharedStream(stream: RemoteStream): void {
  if (stream.closed) {
    return;
  }
  stream.detachSource();
  if (stream.timer) {
    clearInterval(stream.timer);
    stream.timer = null;
  }
  stream.controller = null;
  stream.detachSource = onVideo(stream.deviceId, {
    onConfig: (config) => emitConfig(stream, config),
    onFrame: (data, keyFrame, timestamp) =>
      emitFrame(stream, data, keyFrame, timestamp),
  });
}

function bridgeParams(target: StreamTarget): Record<string, number> {
  return {
    bitrate: target.bitrate,
    maxDim: target.level.maxDim,
    fps: target.level.fps,
  };
}

async function startAdaptive(stream: RemoteStream): Promise<void> {
  const bridge = getBridgeForUdid(stream.deviceId);
  if (!bridge) {
    throw new Error("no bridge for device");
  }
  const controller = new RemoteBitrateController(Date.now());
  const response = await bridge.sendCommand({
    cmd: "start_remote_stream",
    ...bridgeParams(controller.target),
  });
  if (!response.ok || typeof response.port !== "number") {
    // An older bridge binary without the remote encoder.
    throw new Error(String(response.error ?? "start_remote_stream refused"));
  }
  if (stream.closed) {
    bridge.sendCommand({ cmd: "stop_remote_stream" }).catch(() => {});

    return;
  }

  const parser = new H264AccessUnitParser({
    onConfig: (config) => emitConfig(stream, config),
    onFrame: (data, keyFrame, timestamp) =>
      emitFrame(stream, data, keyFrame, timestamp),
  });
  const socket = net.connect(response.port, "127.0.0.1");
  socket.on("data", (chunk: Buffer) => parser.push(chunk));
  socket.on("error", (err) => {
    error(`[RemoteVideo] stream socket error (${stream.deviceId}):`, err);
  });
  socket.on("close", () => {
    // The bridge went away under us; keep viewers fed from the shared stream.
    if (!stream.closed && stream.controller === controller) {
      log(`[RemoteVideo] adaptive stream closed (${stream.deviceId})`);
      getBridgeForUdid(stream.deviceId)
        ?.sendCommand({ cmd: "stop_remote_stream" })
        .catch(() => {});
      useSharedStream(stream);
    }
  });

  stream.controller = controller;
  stream.detachSource = () => {
    socket.destroy();
    parser.reset();
  };
  stream.timer = setInterval(() => sample(stream), SAMPLE_INTERVAL_MS);
  stream.timer.unref?.();
  log(
    `[RemoteVideo] adaptive stream for ${stream.deviceId} at ${describe(controller.target)}`,
  );
}

function sample(stream: RemoteStream): void {
  const controller = stream.controller;
  if (!controller) {
    return;
  }
  const samples = new Map<string, ViewerSample>();
  for (const [id, v] of stream.viewers) {
    samples.set(id, {
      buffered: v.viewer.buffered(),
      sentBytes: v.sentBytes,
      dropped: v.dropped,
    });
  }
  const next = controller.update(Date.now(), samples);
  if (!next) {
    return;
  }
  log(`[RemoteVideo] ${stream.deviceId} → ${describe(next)}`);
  getBridgeForUdid(stream.deviceId)
    ?.sendCommand({ cmd: "set_stream_params", ...bridgeParams(next) })
    .catch(() => {});
}

function describe(target: StreamTarget): string {
  return `${String(Math.round(target.bitrate / 1000))} kbps, ${target.level.name}`;
}

function closeStream(stream: RemoteStream): void {
  stream.closed = true;
  streams.delete(stream.deviceId);
  if (stream.timer) {
    clearInterval(stream.timer);
  }
  stream.detachSource();
  const adaptive = stream.controller !== null;
  if (adaptive) {
    getBridgeForUdid(stream.deviceId)
      ?.sendCommand({ cmd: "stop_remote_stream" })
      .catch(() => {});
  }
  const stats = stream.controller?.stats;
  capture("simulator_remote_stream_ended", {
    adaptive,
    downshifts_bucket: countBucket(stats?.downshifts ?? 0),
    duration_bucket: durationBucket(Date.now() - stream.startedAt),
    lowest_level: stats?.lowest ?? "full",
    platform: stream.platform,
  });
}

function durationBucket(ms: number): "<1m" | "<10m" | "<10s" | ">=10m" {
  if (ms < 10_000) {
    return "<10s";
  }
  if (ms < 60_000) {
    return "<1m";
  }

  return ms < 600_000 ? "<10m" : ">=10m";
}

function countBucket(n: number): "0" | "1-2" | "3-10" | "10+" {
  if (n === 0) {
    return "0";
  }
  if (n <= 2) {
    return "1-2";
  }

  return n <= 10 ? "3-10" : "10+";
}
