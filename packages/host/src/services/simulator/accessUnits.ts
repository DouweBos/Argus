/**
 * Whole H.264 access units, as NAL lists, into a {@link VideoSink}: for sources
 * that already know where a frame ends (AVCC envelopes, RTP markers) and so
 * don't need the Annex B parser's look-ahead, which holds the last frame of a
 * still screen back until the next one arrives.
 */

import type { VideoSink } from "./deviceSource";
import { type H264Config, h264ConfigFor } from "./h264-parser";

const NAL_IDR = 5;
const NAL_SPS = 7;
const NAL_PPS = 8;
/** Access unit delimiter: framing only, nothing a decoder needs. */
const NAL_AUD = 9;

const FRAME_US = 33_333;

function sameBytes(a: Uint8Array | null, b: Uint8Array): boolean {
  return a !== null && a.length === b.length && a.every((v, i) => v === b[i]);
}

/** Emits config when SPS/PPS change and before every keyframe, like the Annex B path. */
export class AccessUnitWriter {
  private sps: Uint8Array | null = null;
  private pps: Uint8Array | null = null;
  private config: H264Config | null = null;
  private timestamp = 0;

  constructor(private readonly sink: VideoSink) {}

  /** One access unit's NALs (no start codes, no length prefixes). */
  push(nals: Uint8Array[]): void {
    const body: Uint8Array[] = [];
    let key = false;
    for (const nal of nals) {
      if (nal.length === 0) {
        continue;
      }
      const type = nal[0] & 0x1f;
      if (type === NAL_SPS) {
        if (!sameBytes(this.sps, nal)) {
          this.sps = nal;
          this.config = null;
        }
      } else if (type === NAL_PPS) {
        if (!sameBytes(this.pps, nal)) {
          this.pps = nal;
          this.config = null;
        }
      } else if (type !== NAL_AUD) {
        key ||= type === NAL_IDR;
        body.push(nal);
      }
    }
    if (!this.config && this.sps && this.pps) {
      this.config = h264ConfigFor(this.sps, this.pps);
      if (!key) {
        this.sink.onConfig(this.config);
      }
    }
    // No decoder can start without a config, and a delta frame before it is noise.
    if (!this.config || body.length === 0) {
      return;
    }
    if (key) {
      this.sink.onConfig(this.config);
    }
    this.timestamp += FRAME_US;
    this.sink.onFrame(lengthPrefixed(body), key, this.timestamp);
  }

  /** Seed SPS/PPS from an avcC record (AVCC streams send it out of band). */
  configure(avcC: Uint8Array): void {
    const { sps, pps } = parseAvcC(avcC);
    if (sps && pps) {
      this.push([sps, pps]);
    }
  }
}

/** NALs as 4-byte big-endian length-prefixed units, what every Argus decoder takes. */
export function lengthPrefixed(nals: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(nals.reduce((n, nal) => n + 4 + nal.length, 0));
  const view = new DataView(out.buffer);
  let at = 0;
  for (const nal of nals) {
    view.setUint32(at, nal.length);
    out.set(nal, at + 4);
    at += 4 + nal.length;
  }

  return out;
}

/** Split length-prefixed NALs; a truncated tail is dropped. */
export function splitLengthPrefixed(
  data: Uint8Array,
  lengthSize = 4,
): Uint8Array[] {
  const nals: Uint8Array[] = [];
  let at = 0;
  while (at + lengthSize <= data.length) {
    let len = 0;
    for (let i = 0; i < lengthSize; i++) {
      len = len * 256 + data[at + i];
    }
    at += lengthSize;
    if (len === 0 || at + len > data.length) {
      break;
    }
    nals.push(data.subarray(at, at + len));
    at += len;
  }

  return nals;
}

/** The first SPS and PPS of an AVCDecoderConfigurationRecord, and its NAL length size. */
export function parseAvcC(record: Uint8Array): {
  lengthSize: number;
  pps: Uint8Array | null;
  sps: Uint8Array | null;
} {
  const none = { lengthSize: 4, sps: null, pps: null };
  if (record.length < 7 || record[0] !== 1) {
    return none;
  }
  const lengthSize = (record[4] & 0x03) + 1;
  let at = 5;
  const read = (count: number): Uint8Array | null => {
    let first: Uint8Array | null = null;
    for (let i = 0; i < count; i++) {
      if (at + 2 > record.length) {
        return first;
      }
      const len = (record[at] << 8) | record[at + 1];
      at += 2;
      if (at + len > record.length) {
        return first;
      }
      first ??= record.subarray(at, at + len);
      at += len;
    }

    return first;
  };
  const sps = read(record[at++] & 0x1f);
  if (at >= record.length) {
    return { lengthSize, sps, pps: null };
  }
  const pps = read(record[at++]);

  return { lengthSize, sps, pps };
}
