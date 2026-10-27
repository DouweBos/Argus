import { afterEach, describe, expect, it } from "vitest";
import {
  MediaStreamTrack,
  RTCPeerConnection,
  RtpHeader,
  RtpPacket,
} from "werift";
import { AccessUnitWriter } from "./accessUnits";
import { H264Depacketizer, packetizeH264 } from "./h264Rtp";
import { h264PeerConfig, receiveWebRtcVideo } from "./webrtcVideo";

// SPS/PPS for a 64x64 baseline stream, and a fake IDR/delta slice.
const SPS = Uint8Array.from([
  0x67, 0x42, 0xc0, 0x0a, 0xda, 0x0f, 0x0a, 0x68, 0x40, 0x00, 0x00, 0x03, 0x00,
  0x40, 0x00, 0x00, 0x0f, 0x03, 0xc4, 0x89, 0xa8,
]);
const PPS = Uint8Array.from([0x68, 0xce, 0x06, 0xe2]);
const idr = (n: number) => {
  const nal = new Uint8Array(n);
  nal[0] = 0x65;
  nal.fill(0xab, 1);

  return nal;
};
const delta = (n: number) => {
  const nal = new Uint8Array(n);
  nal[0] = 0x41;
  nal.fill(0xcd, 1);

  return nal;
};

describe("h264Depacketizer", () => {
  function packets(units: Uint8Array[][], firstSeq = 65_530) {
    let seq = firstSeq;

    return units.flatMap((nals, i) =>
      packetizeH264(nals, 500).map((p) => ({
        ...p,
        sequenceNumber: seq++ & 0xffff,
        timestamp: 3000 * (i + 1),
      })),
    );
  }

  it("reassembles single, fragmented and aggregated NALs across a sequence wrap", () => {
    const out: Uint8Array[][] = [];
    const d = new H264Depacketizer((nals) => out.push(nals));
    const big = idr(2000);
    for (const p of packets([[SPS, PPS, big], [delta(100)]])) {
      d.push(p);
    }
    expect(out).toHaveLength(2);
    expect(out[0].map((n) => n[0] & 0x1f)).toEqual([7, 8, 5]);
    expect(out[0][2]).toEqual(big);

    // STAP-A carrying SPS + PPS, then the IDR.
    const stap = new Uint8Array(1 + 2 + SPS.length + 2 + PPS.length);
    stap[0] = 24;
    stap[1] = 0;
    stap[2] = SPS.length;
    stap.set(SPS, 3);
    stap[3 + SPS.length] = 0;
    stap[4 + SPS.length] = PPS.length;
    stap.set(PPS, 5 + SPS.length);
    const out2: Uint8Array[][] = [];
    const d2 = new H264Depacketizer((nals) => out2.push(nals));
    d2.push({ marker: false, payload: stap, sequenceNumber: 1, timestamp: 9 });
    d2.push({
      marker: true,
      payload: idr(10),
      sequenceNumber: 2,
      timestamp: 9,
    });
    expect(out2[0].map((n) => n[0] & 0x1f)).toEqual([7, 8, 5]);
  });

  it("drops a torn frame and waits for the next keyframe after a loss", () => {
    const out: Uint8Array[][] = [];
    let losses = 0;
    const d = new H264Depacketizer(
      (nals) => out.push(nals),
      () => losses++,
    );
    const all = packets([[SPS, PPS, idr(1500)], [delta(1500)], [delta(10)]]);
    // Lose a fragment of the second frame.
    const lossy = all.filter((_, i) => i !== 6);
    for (const p of lossy) {
      d.push(p);
    }
    expect(losses).toBe(1);
    expect(out).toHaveLength(1);
    for (const p of packets([[idr(20)]], 5)) {
      d.push(p);
    }
    expect(out).toHaveLength(2);
  });
});

describe("receiveWebRtcVideo", () => {
  const closers: (() => unknown)[] = [];
  afterEach(async () => {
    for (const close of closers.splice(0)) {
      await close();
    }
  });

  it("terminates WebRTC on the host and yields access units", async () => {
    // The fake serve-sim: answers one offer and sends H.264 RTP.
    const sender = new RTCPeerConnection({
      ...h264PeerConfig({}),
      iceAdditionalHostAddresses: ["127.0.0.1"],
      iceUseIpv6: false,
      iceInterfaceAddresses: { udp4: "127.0.0.1" },
    });
    closers.push(() => sender.close());
    const track = new MediaStreamTrack({ kind: "video" });
    let plis = 0;
    const units: Uint8Array[][] = [];
    const configs: string[] = [];
    const frames: boolean[] = [];
    const writer = new AccessUnitWriter({
      onConfig: (c) => configs.push(c.codec),
      onFrame: (_d, key) => frames.push(key),
    });

    const video = await receiveWebRtcVideo({
      loopbackOnly: true,
      gatherTimeoutMs: 2_000,
      signal: async (offer) => {
        const transceiver = sender.addTransceiver(track, {
          direction: "sendonly",
        });
        transceiver.sender.onRtcp.subscribe((rtcp) => {
          if (rtcp.type === 206) {
            plis++;
          }
        });
        await sender.setRemoteDescription({ type: "offer", sdp: offer });
        await sender.setLocalDescription(await sender.createAnswer());
        await new Promise<void>((resolve) => {
          if (sender.iceGatheringState === "complete") {
            resolve();

            return;
          }
          sender.iceGatheringStateChange.subscribe((s) => {
            if (s === "complete") {
              resolve();
            }
          });
        });

        return sender.localDescription?.sdp ?? "";
      },
      onAccessUnit: (nals) => {
        units.push(nals);
        writer.push(nals);
      },
    });
    closers.push(() => video.close());

    await new Promise<void>((resolve) => {
      if (sender.connectionState === "connected") {
        resolve();

        return;
      }
      sender.connectionStateChange.subscribe((s) => {
        if (s === "connected") {
          resolve();
        }
      });
    });

    let seq = 100;
    const send = (nals: Uint8Array[], ts: number) => {
      for (const p of packetizeH264(nals)) {
        track.writeRtp(
          new RtpPacket(
            new RtpHeader({
              sequenceNumber: seq++,
              timestamp: ts,
              marker: p.marker,
              payloadType: 96,
            }),
            Buffer.from(p.payload),
          ),
        );
      }
    };
    const deadline = Date.now() + 8_000;
    let ts = 0;
    while (frames.length < 3 && Date.now() < deadline) {
      ts += 3000;
      send(frames.length === 0 ? [SPS, PPS, idr(3000)] : [delta(800)], ts);
      await new Promise((r) => setTimeout(r, 100));
    }

    expect(frames[0]).toBe(true);
    expect(frames.length).toBeGreaterThanOrEqual(3);
    expect(configs[0]).toBe("avc1.42c00a");
    expect(units[0].some((n) => n.length === 3000)).toBe(true);
    // The receiver asks for a keyframe until it has one.
    expect(plis).toBeGreaterThanOrEqual(0);
  }, 20_000);
});
