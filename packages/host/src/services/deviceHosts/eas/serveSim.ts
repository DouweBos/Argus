/**
 * serve-sim, the streaming server inside every EAS Simulator session, spoken
 * from the host so the session token never reaches a client. Video is asked
 * for as AVCC first; a serve-sim locked to WebRTC (EAS always is) answers 409,
 * and then the host terminates WebRTC itself and depacketizes the H.264. Both
 * end as the access units every other source produces. Input is serve-sim's
 * tagged-JSON WebSocket.
 */

import type { ServeSimEndpoint } from "./ids";
import type { VideoSink, VideoStream } from "../../simulator/deviceSource";
import { randomUUID } from "node:crypto";
import { createLogger } from "@argus/host/logger";
import {
  AccessUnitWriter,
  parseAvcC,
  splitLengthPrefixed,
} from "../../simulator/accessUnits";
import {
  type IceServer,
  receiveWebRtcVideo,
} from "../../simulator/webrtcVideo";
import { EasError, scrub } from "./credential";
import { easFetch } from "./http";

const log = createLogger("eas");

const PREVIEW_TIMEOUT_MS = 20_000;
const RETRY_MS = 2_000;
/** A body that stays open without frames is reopened after this. */
const STALL_MS = 15_000;

const AVCC_DESCRIPTION = 1;
const AVCC_KEYFRAME = 2;
const AVCC_DELTA = 3;

function authHeaders(token: string): Record<string, string> {
  return { authorization: `Bearer ${token}` };
}

export function enc(segment: string): string {
  return encodeURIComponent(segment);
}

/** The simulator's UDID inside the session: serve-sim names devices by it. */
export async function previewDevice(
  origin: string,
  token: string,
): Promise<string> {
  let last: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await easFetch(`${origin}/api`, {
        headers: authHeaders(token),
        signal: AbortSignal.timeout(PREVIEW_TIMEOUT_MS),
      });
      if (res.ok) {
        const body = (await res.json()) as { device?: unknown };
        if (typeof body.device === "string" && body.device) {
          return body.device;
        }
      }
      last = new Error(`HTTP ${String(res.status)}`);
    } catch (e) {
      last = e;
    }
    await new Promise((r) => setTimeout(r, RETRY_MS));
  }
  throw new EasError(
    "stream",
    `The EAS Simulator session's preview host did not answer (${scrub(String(last), token)}).`,
  );
}

/** Four-byte big-endian length, then a tag byte and its payload. */
export class AvccDemuxer {
  private buffer = Buffer.alloc(0);

  push(chunk: Uint8Array): { tag: number; payload: Uint8Array }[] {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    const out: { tag: number; payload: Uint8Array }[] = [];
    let at = 0;
    while (this.buffer.length - at >= 4) {
      const len = this.buffer.readUInt32BE(at);
      if (this.buffer.length - at - 4 < len) {
        break;
      }
      if (len >= 1) {
        out.push({
          tag: this.buffer[at + 4],
          payload: new Uint8Array(this.buffer.subarray(at + 5, at + 4 + len)),
        });
      }
      at += 4 + len;
    }
    this.buffer = this.buffer.subarray(at);

    return out;
  }
}

interface WebRtcSettings {
  iceServers?: IceServer[];
  iceTransportPolicy?: "all" | "relay";
}

/** serve-sim reports its stream settings as `streamSettings` (EAS) or `stream`. */
async function webRtcSettings(ep: ServeSimEndpoint): Promise<WebRtcSettings> {
  try {
    const res = await easFetch(`${ep.origin}/api?device=${enc(ep.udid)}`, {
      headers: authHeaders(ep.token),
      signal: AbortSignal.timeout(5_000),
    });
    if (!res.ok) {
      return {};
    }
    const api = (await res.json()) as {
      stream?: WebRtcSettings;
      streamSettings?: WebRtcSettings;
    };
    const s = api.streamSettings ?? api.stream ?? {};

    return {
      iceServers: Array.isArray(s.iceServers) ? s.iceServers : undefined,
      iceTransportPolicy:
        s.iceTransportPolicy === "relay" ? "relay" : undefined,
    };
  } catch {
    return {};
  }
}

/**
 * The device's shared stream: AVCC while serve-sim serves it, WebRTC once it
 * says it is locked to that. Reconnects until closed.
 */
export function openServeSimVideo(
  endpoint: () => ServeSimEndpoint | null,
  sink: VideoSink,
  onConfig?: (width: number, height: number) => void,
): VideoStream {
  let closed = false;
  let abort: AbortController | null = null;
  let peer: { close: () => void } | null = null;
  let retry: ReturnType<typeof setTimeout> | null = null;
  let webrtc = false;
  const writer = new AccessUnitWriter({
    onConfig: (config) => {
      onConfig?.(config.codedWidth, config.codedHeight);
      sink.onConfig(config);
    },
    onFrame: (data, key, ts) => sink.onFrame(data, key, ts),
  });

  const schedule = () => {
    if (closed || retry) {
      return;
    }
    retry = setTimeout(() => {
      retry = null;
      connect().catch(() => undefined);
    }, RETRY_MS);
    retry.unref?.();
  };

  const readAvcc = async (ep: ServeSimEndpoint): Promise<void> => {
    const controller = new AbortController();
    abort = controller;
    const res = await easFetch(
      `${ep.origin}/helper/${enc(ep.udid)}/stream.avcc`,
      { headers: authHeaders(ep.token), signal: controller.signal },
    );
    if (res.status === 409) {
      const body = (await res.json().catch(() => null)) as {
        error?: string;
      } | null;
      if (body?.error === "stream_transport_locked") {
        webrtc = true;

        return readWebRtc(ep);
      }
    }
    if (!res.ok || !res.body) {
      throw new Error(`stream ${String(res.status)}`);
    }
    const demuxer = new AvccDemuxer();
    let lengthSize = 4;
    const reader = res.body.getReader();
    for (;;) {
      const stall = setTimeout(() => controller.abort(), STALL_MS);
      let result: { done: boolean; value?: Uint8Array };
      try {
        result = await reader.read();
      } finally {
        clearTimeout(stall);
      }
      if (result.done || !result.value || closed) {
        return;
      }
      for (const { tag, payload } of demuxer.push(result.value)) {
        if (tag === AVCC_DESCRIPTION) {
          lengthSize = parseAvcC(payload).lengthSize;
          writer.configure(payload);
        } else if (tag === AVCC_KEYFRAME || tag === AVCC_DELTA) {
          writer.push(splitLengthPrefixed(payload, lengthSize));
        }
      }
    }
  };

  const readWebRtc = async (ep: ServeSimEndpoint): Promise<void> => {
    const settings = await webRtcSettings(ep);
    if (closed) {
      return;
    }
    const sessionId = randomUUID();
    let ended: () => void = () => {};
    const done = new Promise<void>((resolve) => {
      ended = resolve;
    });
    let lastUnit = Date.now();
    const watchdog = setInterval(() => {
      if (Date.now() - lastUnit > STALL_MS) {
        log.info("WebRTC stream stalled; reconnecting");
        ended();
      }
    }, STALL_MS / 3);
    watchdog.unref?.();
    done.then(() => clearInterval(watchdog)).catch(() => undefined);
    const video = await receiveWebRtcVideo({
      ...settings,
      onAccessUnit: (nals) => {
        lastUnit = Date.now();
        writer.push(nals);
      },
      onEnded: (reason) => {
        log.info(`WebRTC stream ended: ${reason}`);
        ended();
      },
      signal: async (sdp) => {
        const res = await easFetch(
          `${ep.origin}/helper/${enc(ep.udid)}/webrtc/offer`,
          {
            method: "POST",
            headers: {
              ...authHeaders(ep.token),
              "content-type": "application/json",
            },
            body: JSON.stringify({
              type: "offer",
              sdp,
              sessionId,
              codec: "h264",
            }),
            signal: AbortSignal.timeout(20_000),
          },
        );
        // 409 here: another viewer is still negotiating with this simulator.
        if (!res.ok) {
          throw new Error(`offer refused (${String(res.status)})`);
        }
        const answer = (await res.json()) as { sdp?: unknown; type?: unknown };
        if (answer.type !== "answer" || typeof answer.sdp !== "string") {
          throw new Error("invalid answer");
        }

        return answer.sdp;
      },
    }).catch((e: unknown) => {
      ended();
      throw e;
    });
    let released = false;
    peer = {
      close: () => {
        ended();
        if (released) {
          return;
        }
        released = true;
        video.close();
        // Releases serve-sim's capture session; best effort.
        easFetch(`${ep.origin}/helper/${enc(ep.udid)}/webrtc/close`, {
          method: "POST",
          headers: {
            ...authHeaders(ep.token),
            "content-type": "application/json",
          },
          body: JSON.stringify({ sessionId }),
          signal: AbortSignal.timeout(5_000),
        }).catch(() => {});
      },
    };
    if (closed) {
      peer.close();

      return;
    }
    await done;
    peer.close();
    peer = null;
  };

  const connect = async () => {
    const ep = endpoint();
    if (closed) {
      return;
    }
    if (!ep) {
      sink.onClose?.();
      closed = true;

      return;
    }
    try {
      await (webrtc ? readWebRtc(ep) : readAvcc(ep));
    } catch (e) {
      if (!closed) {
        log.warn(`serve-sim stream failed: ${scrub(String(e), ep.token)}`);
      }
    }
    schedule();
  };

  connect().catch(() => undefined);

  return {
    close: () => {
      if (closed) {
        return;
      }
      closed = true;
      if (retry) {
        clearTimeout(retry);
      }
      abort?.abort();
      peer?.close();
      sink.onClose?.();
    },
  };
}
