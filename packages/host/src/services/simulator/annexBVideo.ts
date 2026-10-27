/**
 * Read a raw H.264 Annex B byte stream (what argus-sim-bridge serves) and
 * deliver it as access units. Sources that produce access units themselves
 * call their sink directly instead.
 */

import type { VideoSink } from "./deviceSource";
import type { Duplex } from "node:stream";
import { H264AccessUnitParser } from "./h264-parser";

/** Parse `socket` into `sink`; returns a close that tears both down. */
export function readAnnexB(socket: Duplex, sink: VideoSink): () => void {
  const parser = new H264AccessUnitParser({
    onConfig: (config) => sink.onConfig(config),
    onFrame: (data, keyFrame, timestamp) =>
      sink.onFrame(data, keyFrame, timestamp),
  });
  socket.on("data", (chunk: Buffer) => {
    parser.push(chunk);
  });
  socket.on("error", (err) => {
    sink.onError?.(err);
  });
  socket.on("close", () => {
    sink.onClose?.();
  });

  return () => {
    socket.destroy();
    parser.reset();
  };
}
