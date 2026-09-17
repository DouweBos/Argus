/**
 * iOS/tvOS H.264 video transport.
 *
 * The native bridge now serves a raw H.264 Annex B byte stream on a TCP port
 * (see native/argus-sim-bridge). This module connects to that port, parses the
 * stream into access units with the shared {@link H264AccessUnitParser}, and
 * forwards config/frame events to the renderer — the same WebCodecs decode path
 * the Android bridge uses.
 *
 * Frames go out on the shared broadcast bus, so every window (main + simulator
 * popouts) and every tap (the remote gateway) sees them.
 */

import * as net from "node:net";
import { emitHostEvent } from "@argus/host/bus";
import { error, log } from "../../../app/lib/logger";
import { H264AccessUnitParser } from "./h264-parser";
import { clearVideo, emitVideoConfig, emitVideoFrame } from "./videoForward";

interface IosVideoStream {
  socket: net.Socket;
  parser: H264AccessUnitParser;
}

/** Per-UDID stream registry, mirroring the bridge registry in ios.ts. */
const streamsByUdid = new Map<string, IosVideoStream>();

/**
 * Connect to the bridge's H.264 stream port for a UDID and start emitting
 * `ios_video_config` / `ios_video_frame` IPC events. Idempotent per UDID —
 * any existing stream is torn down first.
 */
export function startIosVideoStream(udid: string, port: number): void {
  stopIosVideoStream(udid);

  // Route per-UDID: multiple iOS/tvOS devices can be captured at once, so a
  // shared channel would multiplex two H.264 streams into one decoder and
  // corrupt it. Each device streams on its own channel; the renderer subscribes
  // to just its device's stream.
  const parser = new H264AccessUnitParser({
    onConfig: (config) => {
      log(
        `[IosVideo] H.264 config: ${config.codec}, ${String(config.codedWidth)}x${String(config.codedHeight)} (${udid})`,
      );
      emitHostEvent(`ios_video_config:${udid}`, config);
      emitVideoConfig(udid, config);
    },
    onFrame: (data, keyFrame, timestamp) => {
      emitHostEvent(`ios_video_frame:${udid}`, {
        data,
        keyFrame,
        timestamp,
      });
      emitVideoFrame(udid, data, keyFrame, timestamp);
    },
  });

  const socket = net.connect(port, "127.0.0.1", () => {
    log(
      `[IosVideo] connected to bridge stream on port ${String(port)} (${udid})`,
    );
  });

  socket.on("data", (chunk: Buffer) => {
    parser.push(chunk);
  });
  socket.on("error", (err) => {
    error(`[IosVideo] stream socket error (${udid}):`, err);
  });
  socket.on("close", () => {
    log(`[IosVideo] stream socket closed (${udid})`);
  });

  streamsByUdid.set(udid, { socket, parser });
}

/** Tear down the video stream for a UDID. No-op if none is active. */
export function stopIosVideoStream(udid: string): void {
  const stream = streamsByUdid.get(udid);
  if (!stream) {
    return;
  }
  stream.socket.destroy();
  stream.parser.reset();
  streamsByUdid.delete(udid);
  clearVideo(udid);
}
