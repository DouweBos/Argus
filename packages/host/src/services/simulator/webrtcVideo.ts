/**
 * Receive one H.264 video track over WebRTC on the host and hand back access
 * units. werift is a pure-TypeScript stack (ICE, DTLS-SRTP, RTP), so this needs
 * no native addon and the media never has to reach a client as WebRTC: the
 * host re-emits what it receives as the same access units every other source
 * produces.
 */

import { RTCPeerConnection, RTCRtpCodecParameters } from "werift";
import { H264Depacketizer } from "./h264Rtp";

export interface IceServer {
  credential?: string;
  urls: string[] | string;
  username?: string;
}

export interface WebRtcVideoOptions {
  iceServers?: IceServer[];
  iceTransportPolicy?: "all" | "relay";
  /** The remote takes one offer with every candidate and answers it (no trickle). */
  signal: (offerSdp: string) => Promise<string>;
  onAccessUnit: (nals: Uint8Array[]) => void;
  /** The connection failed or closed after it was up. */
  onEnded?: (reason: string) => void;
  /** How long to gather candidates before sending the offer anyway. */
  gatherTimeoutMs?: number;
  /** Bound loopback-only candidates, for tests. */
  loopbackOnly?: boolean;
}

export interface WebRtcVideo {
  close: () => void;
}

const H264 = new RTCRtpCodecParameters({
  mimeType: "video/H264",
  clockRate: 90_000,
  rtcpFeedback: [{ type: "nack" }, { type: "nack", parameter: "pli" }],
  parameters:
    "level-asymmetry-allowed=1;packetization-mode=1;profile-level-id=640033",
});

const H264_BASELINE = new RTCRtpCodecParameters({
  mimeType: "video/H264",
  clockRate: 90_000,
  rtcpFeedback: [{ type: "nack" }, { type: "nack", parameter: "pli" }],
  parameters:
    "level-asymmetry-allowed=1;packetization-mode=1;profile-level-id=42e01f",
});

/** Keyframes are requested this often until the first one arrives. */
const PLI_INTERVAL_MS = 1_000;

export function h264PeerConfig(
  opts: Pick<WebRtcVideoOptions, "iceServers" | "iceTransportPolicy">,
) {
  return {
    codecs: { video: [H264, H264_BASELINE] },
    iceServers: opts.iceServers ?? [],
    iceTransportPolicy: opts.iceTransportPolicy ?? "all",
  };
}

export async function receiveWebRtcVideo(
  opts: WebRtcVideoOptions,
): Promise<WebRtcVideo> {
  const pc = new RTCPeerConnection({
    ...h264PeerConfig(opts),
    ...(opts.loopbackOnly
      ? {
          iceAdditionalHostAddresses: ["127.0.0.1"],
          iceUseIpv6: false,
          iceInterfaceAddresses: { udp4: "127.0.0.1" },
        }
      : {}),
  });
  let closed = false;
  let connected = false;
  let pli: ReturnType<typeof setInterval> | null = null;
  const stopPli = () => {
    if (pli) {
      clearInterval(pli);
      pli = null;
    }
  };
  const close = () => {
    if (closed) {
      return;
    }
    closed = true;
    stopPli();
    pc.close().catch(() => {});
  };

  const transceiver = pc.addTransceiver("video", { direction: "recvonly" });
  pc.onTrack.subscribe((track) => {
    let gotKey = false;
    const requestKey = () => {
      if (track.ssrc !== undefined) {
        transceiver.receiver.sendRtcpPLI(track.ssrc).catch(() => {});
      }
    };
    const depacketizer = new H264Depacketizer((nals) => {
      if (!gotKey && nals.some((n) => (n[0] & 0x1f) === 5)) {
        gotKey = true;
        stopPli();
      }
      opts.onAccessUnit(nals);
    }, requestKey);
    pli = setInterval(() => {
      if (!gotKey) {
        requestKey();
      }
    }, PLI_INTERVAL_MS);
    pli.unref?.();
    track.onReceiveRtp.subscribe((rtp) => {
      if (closed) {
        return;
      }
      depacketizer.push({
        marker: rtp.header.marker,
        payload: rtp.payload,
        sequenceNumber: rtp.header.sequenceNumber,
        timestamp: rtp.header.timestamp,
      });
    });
  });
  pc.connectionStateChange.subscribe((state) => {
    if (state === "connected") {
      connected = true;
    }
    if ((state === "failed" || state === "closed") && !closed) {
      close();
      opts.onEnded?.(connected ? `connection ${state}` : "connection failed");
    }
  });

  try {
    await pc.setLocalDescription(await pc.createOffer());
    await waitForGathering(pc, opts.gatherTimeoutMs ?? 4_000);
    const offer = pc.localDescription?.sdp;
    if (!offer) {
      throw new Error("no local offer");
    }
    const answer = await opts.signal(offer);
    if (closed) {
      return { close };
    }
    await pc.setRemoteDescription({ type: "answer", sdp: answer });
  } catch (e) {
    close();
    throw e;
  }

  return { close };
}

function waitForGathering(
  pc: RTCPeerConnection,
  timeoutMs: number,
): Promise<void> {
  if (pc.iceGatheringState === "complete") {
    return Promise.resolve();
  }

  return new Promise((resolve) => {
    const timer = setTimeout(done, timeoutMs);
    const sub = pc.iceGatheringStateChange.subscribe((state) => {
      if (state === "complete") {
        done();
      }
    });
    function done() {
      clearTimeout(timer);
      sub.unSubscribe();
      resolve();
    }
  });
}
