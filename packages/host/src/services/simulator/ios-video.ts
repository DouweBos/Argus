/**
 * iOS/tvOS H.264 video transport.
 *
 * Opens the device source's shared stream (for the bridge, its raw Annex B
 * port parsed into access units) and forwards config/frame events to the
 * renderer — the same WebCodecs decode path the Android bridge uses.
 *
 * Frames go out on the shared broadcast bus, so every window (main + simulator
 * popouts) and every tap (the remote gateway) sees them.
 */

import type { VideoSource, VideoStream } from "./deviceSource";
import { emitHostEvent } from "@argus/host/bus";
import { error, log } from "@argus/host/logger";
import { clearVideo, emitVideoConfig, emitVideoFrame } from "./videoForward";

/** Per-UDID stream registry, mirroring the capture registry. */
const streamsByUdid = new Map<string, VideoStream>();

/**
 * Open a device's shared stream and start emitting `ios_video_config` /
 * `ios_video_frame` events. Idempotent per UDID — any existing stream is torn
 * down first.
 */
export function startIosVideoStream(udid: string, video: VideoSource): void {
  stopIosVideoStream(udid);

  // Route per-UDID: multiple iOS/tvOS devices can be captured at once, so a
  // shared channel would multiplex two H.264 streams into one decoder and
  // corrupt it. Each device streams on its own channel; the renderer subscribes
  // to just its device's stream.
  const stream = video.open({
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
    onError: (err) => {
      error(`[IosVideo] stream socket error (${udid}):`, err);
    },
    onClose: () => {
      log(`[IosVideo] stream socket closed (${udid})`);
    },
  });

  streamsByUdid.set(udid, stream);
}

/** Tear down the video stream for a UDID. No-op if none is active. */
export function stopIosVideoStream(udid: string): void {
  const stream = streamsByUdid.get(udid);
  if (!stream) {
    return;
  }
  stream.close();
  streamsByUdid.delete(udid);
  clearVideo(udid);
}
