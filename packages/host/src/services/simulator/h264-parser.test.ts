import { describe, expect, it } from "vitest";
import { type H264Config, H264AccessUnitParser } from "./h264-parser";

/** Minimal bit writer — just enough to synthesize a baseline-profile SPS. */
class BitWriter {
  private bits: number[] = [];

  u(n: number, value: number): void {
    for (let i = n - 1; i >= 0; i--) {
      this.bits.push((value >> i) & 1);
    }
  }

  ue(value: number): void {
    const v = value + 1;
    const len = 32 - Math.clz32(v);
    this.u(len - 1, 0);
    this.u(len, v);
  }

  bytes(): Uint8Array {
    while (this.bits.length % 8 !== 0) {
      this.bits.push(0);
    }
    const out = new Uint8Array(this.bits.length / 8);
    this.bits.forEach((bit, i) => {
      out[i >> 3] |= bit << (7 - (i % 8));
    });

    return out;
  }
}

/** Baseline SPS NAL (header byte included) coding the given pixel size. */
function sps(width: number, height: number): Uint8Array {
  const w = new BitWriter();
  w.u(8, 66); // profile_idc — baseline, so no chroma/scaling block
  w.u(8, 0); // constraint flags
  w.u(8, 30); // level_idc
  w.ue(0); // seq_parameter_set_id
  w.ue(0); // log2_max_frame_num_minus4
  w.ue(0); // pic_order_cnt_type
  w.ue(0); // log2_max_pic_order_cnt_lsb_minus4
  w.ue(1); // max_num_ref_frames
  w.u(1, 0); // gaps_in_frame_num_value_allowed_flag
  w.ue(width / 16 - 1); // pic_width_in_mbs_minus1
  w.ue(height / 16 - 1); // pic_height_in_map_units_minus1
  w.u(1, 1); // frame_mbs_only_flag
  w.u(1, 0); // direct_8x8_inference_flag
  w.u(1, 0); // frame_cropping_flag
  w.u(1, 0); // vui_parameters_present_flag

  return new Uint8Array([0x67, ...w.bytes()]);
}

const PPS = new Uint8Array([0x68, 0xce, 0x3c, 0x80]);
const IDR = new Uint8Array([0x65, 0x88, 0x84, 0x00]);
const START = [0, 0, 0, 1];

function annexB(...nals: Uint8Array[]): Uint8Array {
  return new Uint8Array(nals.flatMap((n) => [...START, ...n]));
}

function collect(): { configs: H264Config[]; parser: H264AccessUnitParser } {
  const configs: H264Config[] = [];
  const parser = new H264AccessUnitParser({
    onConfig: (c) => configs.push(c),
    onFrame: () => undefined,
  });

  return { configs, parser };
}

describe("h264AccessUnitParser", () => {
  it("emits the config once for an unchanging stream", () => {
    const { configs, parser } = collect();
    parser.push(annexB(sps(320, 480), PPS, IDR));
    parser.push(annexB(sps(320, 480), PPS, IDR));
    // A trailing start code is needed for the parser to close the last NAL.
    parser.push(new Uint8Array(START));

    expect(configs).not.toHaveLength(0);
    expect(new Set(configs.map((c) => c.codedWidth))).toEqual(new Set([320]));
    expect(configs[0].codedHeight).toBe(480);
  });

  it("re-emits the config when the stream's SPS changes resolution", () => {
    const { configs, parser } = collect();
    parser.push(annexB(sps(320, 480), PPS, IDR));
    // Folding the device swaps panels: the encoder restarts at a new size.
    parser.push(annexB(sps(640, 320), PPS, IDR));
    parser.push(new Uint8Array(START));

    const sizes = configs.map(
      (c) => `${String(c.codedWidth)}x${String(c.codedHeight)}`,
    );
    expect(sizes).toContain("320x480");
    expect(sizes).toContain("640x320");
    expect(sizes.at(-1)).toBe("640x320");
  });
});
