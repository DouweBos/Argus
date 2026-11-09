/**
 * A still image as a device's live picture: one H.264 keyframe, framed the way
 * the host's media channel sends a simulator stream (`MediaMessage` on the Mac).
 */

import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const exec = promisify(execFile);

export interface DeviceStream {
  config: Buffer;
  keyFrame: Buffer;
}

/** `[type u8][flags u8][streamId u16le][timestamp f64le]`, then the body. */
function message(
  type: number,
  flags: number,
  streamId: number,
  body: Buffer,
): Buffer {
  const head = Buffer.alloc(12);
  head[0] = type;
  head[1] = flags;
  head.writeUInt16LE(streamId, 2);
  head.writeDoubleLE(Date.now(), 4);

  return Buffer.concat([head, body]);
}

/** Top-level MP4 boxes, and the `avcC` record nested under `moov`. */
function box(mp4: Buffer, type: string): Buffer {
  if (type === "avcC") {
    const at = mp4.indexOf("avcC");
    if (at < 4) {
      throw new Error("no avcC box in the encoded still");
    }

    return mp4.subarray(at + 4, at - 4 + mp4.readUInt32BE(at - 4));
  }
  for (let at = 0; at + 8 <= mp4.length; ) {
    const size = mp4.readUInt32BE(at);
    if (mp4.toString("latin1", at + 4, at + 8) === type) {
      return mp4.subarray(at + 8, at + size);
    }
    at += size;
  }
  throw new Error(`no ${type} box in the encoded still`);
}

export async function encodeStill(
  png: string,
  streamId: number,
): Promise<DeviceStream> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "argus-still-"));
  const mp4 = path.join(dir, "still.mp4");
  try {
    await exec("ffmpeg", [
      "-loglevel",
      "error",
      "-i",
      png,
      "-frames:v",
      "1",
      "-c:v",
      "libx264",
      "-pix_fmt",
      "yuv420p",
      "-crf",
      "12",
      "-movflags",
      "+faststart",
      mp4,
    ]);
    const bytes = fs.readFileSync(mp4);
    const avcc = box(bytes, "avcC");
    const codec = `avc1.${avcc.subarray(1, 4).toString("hex")}`;
    const { width, height } = dimensions(png);
    const config = Buffer.alloc(5);
    config.writeUInt16LE(width, 0);
    config.writeUInt16LE(height, 2);
    config[4] = codec.length;

    return {
      config: message(
        0,
        0,
        streamId,
        Buffer.concat([config, Buffer.from(codec), avcc]),
      ),
      keyFrame: message(1, 1, streamId, box(bytes, "mdat")),
    };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function dimensions(png: string): { height: number; width: number } {
  const head = fs.readFileSync(png).subarray(16, 24);

  return { width: head.readUInt32BE(0), height: head.readUInt32BE(4) };
}
