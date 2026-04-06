/**
 * H.264 Annex B streaming parser — splits a raw byte stream into NAL units,
 * groups them into access units, and extracts SPS/PPS configuration for
 * WebCodecs VideoDecoder initialization.
 *
 * Only the subset of SPS fields needed for VideoDecoderConfig is parsed:
 * profile_idc, level_idc, and coded dimensions.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface H264Config {
  /** e.g. "avc1.640028" */
  codec: string;
  codedWidth: number;
  codedHeight: number;
  /** AVCC decoder configuration record (SPS + PPS). */
  description: Uint8Array;
}

export interface H264ParserCallbacks {
  onConfig: (config: H264Config) => void;
  onFrame: (data: Uint8Array, keyFrame: boolean, timestamp: number) => void;
}

// ---------------------------------------------------------------------------
// NAL type constants
// ---------------------------------------------------------------------------

const NAL_SLICE = 1;
const NAL_IDR = 5;
const NAL_SEI = 6;
const NAL_SPS = 7;
const NAL_PPS = 8;

// ---------------------------------------------------------------------------
// Exp-Golomb reader (minimal, for SPS parsing)
// ---------------------------------------------------------------------------

class ExpGolombReader {
  private data: Uint8Array;
  private byteOffset = 0;
  private bitOffset = 0;

  constructor(data: Uint8Array) {
    this.data = data;
  }

  private readBit(): number {
    if (this.byteOffset >= this.data.length) return 0;
    const bit = (this.data[this.byteOffset] >> (7 - this.bitOffset)) & 1;
    this.bitOffset++;
    if (this.bitOffset === 8) {
      this.bitOffset = 0;
      this.byteOffset++;
    }
    return bit;
  }

  readBits(n: number): number {
    let val = 0;
    for (let i = 0; i < n; i++) {
      val = (val << 1) | this.readBit();
    }
    return val;
  }

  /** Read unsigned Exp-Golomb coded value. */
  readUE(): number {
    let zeros = 0;
    while (this.readBit() === 0 && zeros < 31) zeros++;
    if (zeros === 0) return 0;
    return (1 << zeros) - 1 + this.readBits(zeros);
  }

  /** Read signed Exp-Golomb coded value. */
  readSE(): number {
    const val = this.readUE();
    if (val % 2 === 0) return -(val >> 1);
    return (val + 1) >> 1;
  }
}

// ---------------------------------------------------------------------------
// SPS parsing — extract profile, level, and dimensions
// ---------------------------------------------------------------------------

interface SpsInfo {
  profileIdc: number;
  constraintFlags: number;
  levelIdc: number;
  width: number;
  height: number;
}

/**
 * Parse the minimum set of SPS fields needed for WebCodecs configuration.
 * `spsNalBody` should be the SPS NAL unit body (after the NAL header byte).
 */
function parseSps(spsNalBody: Uint8Array): SpsInfo {
  const r = new ExpGolombReader(spsNalBody);
  const profileIdc = r.readBits(8);
  const constraintFlags = r.readBits(8);
  const levelIdc = r.readBits(8);
  r.readUE(); // seq_parameter_set_id

  // High profiles have additional chroma/scaling fields
  if (
    profileIdc === 100 ||
    profileIdc === 110 ||
    profileIdc === 122 ||
    profileIdc === 244 ||
    profileIdc === 44 ||
    profileIdc === 83 ||
    profileIdc === 86 ||
    profileIdc === 118 ||
    profileIdc === 128 ||
    profileIdc === 138 ||
    profileIdc === 139 ||
    profileIdc === 134
  ) {
    const chromaFormatIdc = r.readUE();
    if (chromaFormatIdc === 3) r.readBits(1); // separate_colour_plane_flag
    r.readUE(); // bit_depth_luma_minus8
    r.readUE(); // bit_depth_chroma_minus8
    r.readBits(1); // qpprime_y_zero_transform_bypass_flag
    const seqScalingMatrixPresent = r.readBits(1);
    if (seqScalingMatrixPresent) {
      const count = chromaFormatIdc !== 3 ? 8 : 12;
      for (let i = 0; i < count; i++) {
        if (r.readBits(1)) {
          // scaling list — skip
          const size = i < 6 ? 16 : 64;
          let lastScale = 8;
          let nextScale = 8;
          for (let j = 0; j < size; j++) {
            if (nextScale !== 0) {
              const delta = r.readSE();
              nextScale = (lastScale + delta + 256) % 256;
            }
            lastScale = nextScale === 0 ? lastScale : nextScale;
          }
        }
      }
    }
  }

  r.readUE(); // log2_max_frame_num_minus4
  const picOrderCntType = r.readUE();
  if (picOrderCntType === 0) {
    r.readUE(); // log2_max_pic_order_cnt_lsb_minus4
  } else if (picOrderCntType === 1) {
    r.readBits(1); // delta_pic_order_always_zero_flag
    r.readSE(); // offset_for_non_ref_pic
    r.readSE(); // offset_for_top_to_bottom_field
    const numRefFrames = r.readUE();
    for (let i = 0; i < numRefFrames; i++) r.readSE();
  }

  r.readUE(); // max_num_ref_frames
  r.readBits(1); // gaps_in_frame_num_value_allowed_flag

  const picWidthInMbsMinus1 = r.readUE();
  const picHeightInMapUnitsMinus1 = r.readUE();
  const frameMbsOnlyFlag = r.readBits(1);

  let width = (picWidthInMbsMinus1 + 1) * 16;
  let height = (2 - frameMbsOnlyFlag) * (picHeightInMapUnitsMinus1 + 1) * 16;

  if (!frameMbsOnlyFlag) r.readBits(1); // mb_adaptive_frame_field_flag
  r.readBits(1); // direct_8x8_inference_flag

  // Frame cropping
  const frameCroppingFlag = r.readBits(1);
  if (frameCroppingFlag) {
    const cropLeft = r.readUE();
    const cropRight = r.readUE();
    const cropTop = r.readUE();
    const cropBottom = r.readUE();
    // For 4:2:0, crop units are 2 pixels each
    width -= (cropLeft + cropRight) * 2;
    height -= (cropTop + cropBottom) * 2;
  }

  return { profileIdc, constraintFlags, levelIdc, width, height };
}

// ---------------------------------------------------------------------------
// Codec string + AVCC description builders
// ---------------------------------------------------------------------------

/** Build `avc1.PPCCLL` codec string from SPS info. */
function buildCodecString(info: SpsInfo): string {
  const pp = info.profileIdc.toString(16).padStart(2, "0");
  const cc = info.constraintFlags.toString(16).padStart(2, "0");
  const ll = info.levelIdc.toString(16).padStart(2, "0");
  return `avc1.${pp}${cc}${ll}`;
}

/**
 * Build an AVCC decoder configuration record from SPS and PPS NAL unit
 * bodies (without start codes, with NAL header byte).
 */
function buildAvccDescription(sps: Uint8Array, pps: Uint8Array): Uint8Array {
  // AVCC format:
  //   1 byte  configurationVersion = 1
  //   1 byte  AVCProfileIndication  (sps[1])
  //   1 byte  profile_compatibility (sps[2])
  //   1 byte  AVCLevelIndication    (sps[3])
  //   1 byte  lengthSizeMinusOne = 3 (0xFF = reserved bits + 3)
  //   1 byte  numOfSPS = 1 (0xE1 = reserved bits + 1)
  //   2 bytes spsLength
  //   N bytes sps
  //   1 byte  numOfPPS = 1
  //   2 bytes ppsLength
  //   N bytes pps
  const size = 11 + sps.length + pps.length;
  const buf = new Uint8Array(size);
  const view = new DataView(buf.buffer);

  buf[0] = 1; // configurationVersion
  buf[1] = sps[1]; // profile
  buf[2] = sps[2]; // compatibility
  buf[3] = sps[3]; // level
  buf[4] = 0xff; // lengthSizeMinusOne = 3
  buf[5] = 0xe1; // numOfSPS = 1

  view.setUint16(6, sps.length);
  buf.set(sps, 8);

  const ppsOffset = 8 + sps.length;
  buf[ppsOffset] = 1; // numOfPPS
  view.setUint16(ppsOffset + 1, pps.length);
  buf.set(pps, ppsOffset + 3);

  return buf;
}

// ---------------------------------------------------------------------------
// NAL unit start code scanner
// ---------------------------------------------------------------------------

/** Find the index of the next NAL start code (00 00 01 or 00 00 00 01). */
function findStartCode(
  buf: Uint8Array,
  offset: number,
): { index: number; length: number } | null {
  for (let i = offset; i < buf.length - 2; i++) {
    if (buf[i] === 0 && buf[i + 1] === 0) {
      if (buf[i + 2] === 1) return { index: i, length: 3 };
      if (buf[i + 2] === 0 && i + 3 < buf.length && buf[i + 3] === 1) {
        return { index: i, length: 4 };
      }
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// H264AccessUnitParser
// ---------------------------------------------------------------------------

/**
 * Streaming parser that accepts raw H.264 Annex B byte chunks and emits
 * complete access units (frames) plus a one-time configuration event when
 * SPS+PPS are first encountered.
 */
export class H264AccessUnitParser {
  private buffer = new Uint8Array(0);
  private sps: Uint8Array | null = null;
  private pps: Uint8Array | null = null;
  private configEmitted = false;
  private lastConfig: H264Config | null = null;
  private currentAccessUnit: Uint8Array[] = [];
  private currentIsKey = false;
  private callbacks: H264ParserCallbacks;
  private timestamp = 0;

  constructor(callbacks: H264ParserCallbacks) {
    this.callbacks = callbacks;
  }

  /** Feed a chunk of raw H.264 Annex B data. */
  push(chunk: Buffer | Uint8Array): void {
    // Append to buffer
    const next = new Uint8Array(this.buffer.length + chunk.length);
    next.set(this.buffer);
    next.set(chunk, this.buffer.length);
    this.buffer = next;

    this.processBuffer();
  }

  reset(): void {
    this.buffer = new Uint8Array(0);
    this.sps = null;
    this.pps = null;
    this.configEmitted = false;
    this.lastConfig = null;
    this.currentAccessUnit = [];
    this.currentIsKey = false;
    this.timestamp = 0;
  }

  private processBuffer(): void {
    // Find first start code
    let sc = findStartCode(this.buffer, 0);
    if (!sc) return;

    while (true) {
      // Find next start code after this one
      const nextSc = findStartCode(this.buffer, sc.index + sc.length);
      if (!nextSc) break; // Need more data

      // Extract NAL unit (between current and next start code)
      const nalStart = sc.index + sc.length;
      const nalEnd = nextSc.index;
      const nal = this.buffer.slice(nalStart, nalEnd);

      this.processNal(nal, sc.length);

      sc = nextSc;
    }

    // Keep unprocessed data (from last found start code onward)
    if (sc.index > 0) {
      this.buffer = this.buffer.slice(sc.index);
    }

    // Prevent unbounded growth
    if (this.buffer.length > 2 * 1024 * 1024) {
      this.buffer = this.buffer.slice(-512 * 1024);
    }
  }

  private processNal(nal: Uint8Array, startCodeLen: number): void {
    if (nal.length === 0) return;

    const nalType = nal[0] & 0x1f;

    // Collect SPS/PPS for configuration
    if (nalType === NAL_SPS) {
      this.sps = nal;
      this.emitConfigIfReady();
      return;
    }
    if (nalType === NAL_PPS) {
      this.pps = nal;
      this.emitConfigIfReady();
      return;
    }

    // SEI — include in current access unit but don't trigger flush
    if (nalType === NAL_SEI) {
      this.addToAccessUnit(nal, startCodeLen);
      return;
    }

    // VCL NAL (IDR or non-IDR slice) — starts a new access unit if we
    // already have one buffered
    if (nalType === NAL_IDR || nalType === NAL_SLICE) {
      // Flush previous access unit if any
      if (this.currentAccessUnit.length > 0) {
        this.emitAccessUnit();
      }

      this.currentIsKey = nalType === NAL_IDR;
      this.addToAccessUnit(nal, startCodeLen);

      // For simplicity, emit immediately (single-slice frames)
      this.emitAccessUnit();
      return;
    }

    // Other NAL types (AUD, etc.) — just buffer
    this.addToAccessUnit(nal, startCodeLen);
  }

  private addToAccessUnit(nal: Uint8Array, _startCodeLen: number): void {
    // WebCodecs with AVCC description expects length-prefixed NAL units
    // (4-byte big-endian length), NOT Annex B start codes.
    const withLength = new Uint8Array(4 + nal.length);
    const view = new DataView(withLength.buffer);
    view.setUint32(0, nal.length);
    withLength.set(nal, 4);
    this.currentAccessUnit.push(withLength);
  }

  private emitAccessUnit(): void {
    if (this.currentAccessUnit.length === 0) return;
    if (!this.configEmitted) {
      // Can't emit frames until we have SPS+PPS config
      this.currentAccessUnit = [];
      this.currentIsKey = false;
      return;
    }

    // Re-emit config before every keyframe so that new subscribers
    // (e.g. after a tab switch) can configure their decoder.
    if (this.currentIsKey && this.lastConfig) {
      this.callbacks.onConfig(this.lastConfig);
    }

    // Concatenate all NAL units in this access unit
    const totalLen = this.currentAccessUnit.reduce(
      (sum, n) => sum + n.length,
      0,
    );
    const data = new Uint8Array(totalLen);
    let offset = 0;
    for (const n of this.currentAccessUnit) {
      data.set(n, offset);
      offset += n.length;
    }

    this.timestamp += 33333; // ~30fps in microseconds
    this.callbacks.onFrame(data, this.currentIsKey, this.timestamp);

    this.currentAccessUnit = [];
    this.currentIsKey = false;
  }

  private emitConfigIfReady(): void {
    if (!this.sps || !this.pps) return;
    if (this.configEmitted) return;

    const info = parseSps(this.sps.slice(1)); // skip NAL header byte
    const codec = buildCodecString(info);
    const description = buildAvccDescription(this.sps, this.pps);

    this.configEmitted = true;
    this.lastConfig = {
      codec,
      codedWidth: info.width,
      codedHeight: info.height,
      description,
    };
    this.callbacks.onConfig(this.lastConfig);
  }
}
