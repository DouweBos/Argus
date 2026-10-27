/**
 * H.264 over RTP (RFC 6184) back into access units: single NAL packets,
 * STAP-A aggregates and FU-A fragments, grouped by RTP timestamp and closed
 * by the marker bit. A gap in sequence numbers drops the frame being built
 * and everything up to the next keyframe, so a decoder never sees a torn one.
 */

const STAP_A = 24;
const FU_A = 28;
const NAL_IDR = 5;
const NAL_SPS = 7;

export interface RtpPacketLike {
  marker: boolean;
  payload: Uint8Array;
  sequenceNumber: number;
  timestamp: number;
}

export class H264Depacketizer {
  private nals: Uint8Array[] = [];
  private fragment: Uint8Array[] | null = null;
  private timestamp: number | null = null;
  private lastSeq: number | null = null;
  private broken = false;
  /** After a loss, wait for a keyframe before emitting again. */
  private needKey = true;

  constructor(
    private readonly onAccessUnit: (nals: Uint8Array[]) => void,
    /** Called on loss, so the caller can ask the sender for a keyframe. */
    private readonly onLoss?: () => void,
  ) {}

  push(packet: RtpPacketLike): void {
    if (
      this.lastSeq !== null &&
      packet.sequenceNumber !== ((this.lastSeq + 1) & 0xffff)
    ) {
      this.broken = true;
      this.fragment = null;
      this.needKey = true;
      this.onLoss?.();
    }
    this.lastSeq = packet.sequenceNumber;
    if (this.timestamp !== null && packet.timestamp !== this.timestamp) {
      // The previous frame ended without a marker: emit what it has.
      this.flush();
    }
    this.timestamp = packet.timestamp;
    this.read(packet.payload);
    if (packet.marker) {
      this.flush();
    }
  }

  private read(payload: Uint8Array): void {
    if (payload.length === 0) {
      return;
    }
    const type = payload[0] & 0x1f;
    if (type === STAP_A) {
      let at = 1;
      while (at + 2 <= payload.length) {
        const len = (payload[at] << 8) | payload[at + 1];
        at += 2;
        if (len === 0 || at + len > payload.length) {
          break;
        }
        this.nals.push(payload.slice(at, at + len));
        at += len;
      }

      return;
    }
    if (type === FU_A) {
      if (payload.length < 2) {
        return;
      }
      const header = payload[1];
      const start = (header & 0x80) !== 0;
      const end = (header & 0x40) !== 0;
      if (start) {
        const nalHeader = (payload[0] & 0xe0) | (header & 0x1f);
        this.fragment = [Uint8Array.of(nalHeader), payload.slice(2)];
      } else if (this.fragment) {
        this.fragment.push(payload.slice(2));
      }
      if (end && this.fragment) {
        this.nals.push(concat(this.fragment));
        this.fragment = null;
      }

      return;
    }
    if (type >= 1 && type <= 23) {
      this.nals.push(payload.slice());
    }
  }

  private flush(): void {
    const nals = this.nals;
    const broken = this.broken;
    this.nals = [];
    this.fragment = null;
    this.timestamp = null;
    this.broken = false;
    if (broken || nals.length === 0) {
      return;
    }
    const types = nals.map((n) => n[0] & 0x1f);
    if (this.needKey) {
      if (!types.includes(NAL_IDR) && !types.includes(NAL_SPS)) {
        return;
      }
      this.needKey = !types.includes(NAL_IDR);
    }
    this.onAccessUnit(nals);
  }
}

function concat(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }

  return out;
}

/** Packetize one access unit (for tests and fakes): FU-A above `mtu`. */
export function packetizeH264(
  nals: Uint8Array[],
  mtu = 1200,
): { marker: boolean; payload: Uint8Array }[] {
  const out: { marker: boolean; payload: Uint8Array }[] = [];
  for (const nal of nals) {
    if (nal.length <= mtu) {
      out.push({ marker: false, payload: nal });
      continue;
    }
    const indicator = (nal[0] & 0xe0) | FU_A;
    const type = nal[0] & 0x1f;
    for (let at = 1; at < nal.length; at += mtu - 2) {
      const chunk = nal.subarray(at, Math.min(nal.length, at + mtu - 2));
      const start = at === 1 ? 0x80 : 0;
      const end = at + mtu - 2 >= nal.length ? 0x40 : 0;
      const payload = new Uint8Array(2 + chunk.length);
      payload[0] = indicator;
      payload[1] = start | end | type;
      payload.set(chunk, 2);
      out.push({ marker: false, payload });
    }
  }
  if (out.length > 0) {
    out[out.length - 1].marker = true;
  }

  return out;
}
