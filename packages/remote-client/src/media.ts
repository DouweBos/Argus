/**
 * The client half of the TAG_MEDIA channel: parse the host's binary device-screen
 * messages, route them to whoever is watching that stream, and decode H.264
 * access units to a canvas with WebCodecs.
 *
 * Lives here rather than in Peacock because none of it is UI — it is the media
 * half of the gateway transport this package already owns, and Peacock must stay
 * free of wire formats. The desktop's runtime panel and the web client share
 * this one implementation; before, each had its own.
 */

/** Cap wire-controlled dimensions — a 65535² frame is a multi-GB allocation. */
const MAX_DIMENSION = 8192;

export interface H264DecoderCallbacks {
  /** Natural video dimensions changed (for touch coordinate normalization). */
  onDimensions?: (width: number, height: number) => void;
  /** Fired once the first frame has rendered. */
  onFirstFrame?: () => void;
  /** The decoder accepted a config (SPS/PPS) and is ready for access units. */
  onConfigured?: (configured: boolean) => void;
}

export class H264CanvasDecoder {
  private decoder: VideoDecoder | null = null;
  private canvas: HTMLCanvasElement | null = null;
  private ctx: CanvasRenderingContext2D | null = null;
  /** Identity of the applied config — skip identical re-emitted configs. */
  private configKey: string | null = null;
  /** WebCodecs must (re)start on a keyframe; drop deltas until one arrives. */
  private awaitingKeyframe = true;
  private receiving = false;

  width = 0;
  height = 0;

  constructor(private readonly callbacks: H264DecoderCallbacks = {}) {}

  /** Whether the browser can decode H.264 via WebCodecs at all. */
  static get supported(): boolean {
    return typeof window !== "undefined" && "VideoDecoder" in window;
  }

  attachCanvas(canvas: HTMLCanvasElement | null): void {
    this.canvas = canvas;
    this.ctx = canvas?.getContext("2d") ?? null;
    if (canvas && this.width > 0) {
      canvas.width = this.width;
      canvas.height = this.height;
    }
  }

  configure(
    codec: string,
    rawWidth: number,
    rawHeight: number,
    description: Uint8Array,
  ): void {
    const codedWidth = Math.min(MAX_DIMENSION, Math.max(1, rawWidth));
    const codedHeight = Math.min(MAX_DIMENSION, Math.max(1, rawHeight));
    const configKey = `${codec}|${String(codedWidth)}x${String(codedHeight)}|${String(description.length)}|${Array.from(description.subarray(0, 16)).join(",")}`;
    if (this.decoder?.state === "configured" && this.configKey === configKey) {
      return;
    }
    this.configKey = configKey;

    if (this.decoder && this.decoder.state !== "closed") {
      this.decoder.close();
    }

    this.width = codedWidth;
    this.height = codedHeight;
    this.callbacks.onDimensions?.(codedWidth, codedHeight);
    // Only resize when the dimensions actually change — assigning canvas.width
    // (even to the same value) clears the canvas to black. Recreating the
    // decoder after a transient decode error must not blank the last frame.
    if (
      this.canvas &&
      (this.canvas.width !== codedWidth || this.canvas.height !== codedHeight)
    ) {
      this.canvas.width = codedWidth;
      this.canvas.height = codedHeight;
    }

    const decoder = new VideoDecoder({
      output: (frame) => {
        const canvas = this.canvas;
        if (!canvas) {
          frame.close();

          return;
        }
        if (
          canvas.width !== frame.displayWidth ||
          canvas.height !== frame.displayHeight
        ) {
          canvas.width = frame.displayWidth;
          canvas.height = frame.displayHeight;
          this.width = frame.displayWidth;
          this.height = frame.displayHeight;
          this.callbacks.onDimensions?.(
            frame.displayWidth,
            frame.displayHeight,
          );
        }
        this.ctx?.drawImage(frame, 0, 0);
        frame.close();
        if (!this.receiving) {
          this.receiving = true;
          this.callbacks.onFirstFrame?.();
        }
      },
      error: () => {
        // Decode error — resync on the next keyframe rather than throwing.
        this.awaitingKeyframe = true;
      },
    });
    // A malformed codec/description throws synchronously here — drop the config
    // rather than tearing down the media read path.
    try {
      decoder.configure({ codec, codedWidth, codedHeight, description });
    } catch {
      this.decoder = null;
      this.configKey = null;
      this.callbacks.onConfigured?.(false);

      return;
    }

    this.decoder = decoder;
    this.awaitingKeyframe = true;
    this.callbacks.onConfigured?.(true);
  }

  decode(data: Uint8Array, keyFrame: boolean, timestamp: number): void {
    const decoder = this.decoder;
    if (!decoder || decoder.state !== "configured") {
      return;
    }
    if (this.awaitingKeyframe) {
      if (!keyFrame) {
        return;
      }
      this.awaitingKeyframe = false;
    }
    // Shed frames if the decode queue is backing up. Dropping a delta breaks
    // the reference chain for the frames that follow, so resync on the next
    // keyframe instead of feeding the decoder deltas it can't decode (which
    // would throw, tear the decoder down, and flash the canvas).
    if (decoder.decodeQueueSize > 3) {
      this.awaitingKeyframe = true;

      return;
    }
    try {
      decoder.decode(
        new EncodedVideoChunk({
          type: keyFrame ? "key" : "delta",
          timestamp,
          data,
        }),
      );
    } catch {
      this.awaitingKeyframe = true;
    }
  }

  close(): void {
    if (this.decoder && this.decoder.state !== "closed") {
      this.decoder.close();
    }
    this.decoder = null;
    this.configKey = null;
    this.awaitingKeyframe = true;
    this.receiving = false;
    this.callbacks.onConfigured?.(false);
  }
}

/**
 * Parse a binary media message (the bytes after the transport's media tag).
 * Mirrors the desktop's `buildConfigBody` / `buildFrameBody` layout.
 */
export type MediaMessage =
  | {
      kind: "config";
      streamId: number;
      codec: string;
      codedWidth: number;
      codedHeight: number;
      description: Uint8Array;
    }
  | {
      kind: "frame";
      streamId: number;
      keyFrame: boolean;
      timestamp: number;
      data: Uint8Array;
    };

export function parseMediaMessage(bytes: Uint8Array): MediaMessage | null {
  if (bytes.length < 12) {
    return null;
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const msgType = view.getUint8(0);
  const flags = view.getUint8(1);
  const streamId = view.getUint16(2, true);
  const timestamp = view.getFloat64(4, true);

  if (msgType === 0) {
    // config: [codedW u16][codedH u16][codecLen u8][codec][description]
    if (bytes.length < 17) {
      return null;
    }
    const codedWidth = view.getUint16(12, true);
    const codedHeight = view.getUint16(14, true);
    const codecLen = view.getUint8(16);
    const codec = new TextDecoder().decode(bytes.subarray(17, 17 + codecLen));
    const description = bytes.slice(17 + codecLen);

    return {
      kind: "config",
      streamId,
      codec,
      codedWidth,
      codedHeight,
      description,
    };
  }

  // frame
  return {
    kind: "frame",
    streamId,
    keyFrame: (flags & 1) === 1,
    timestamp,
    data: bytes.slice(12),
  };
}

export type MediaSink = (msg: MediaMessage) => void;

/**
 * Fans the single TAG_MEDIA byte stream out to per-stream sinks.
 *
 * Frames that arrive before a view registers are briefly buffered: the host
 * emits the config the instant `devices.watch` starts the capture, which
 * usually beats the watch response back to the client, and without the config
 * the decoder can never start.
 */
export class MediaRouter {
  private readonly sinks = new Map<number, MediaSink>();
  private readonly buffered = new Map<number, MediaMessage[]>();

  /** Frames held per stream while nobody is listening yet. */
  private static readonly BUFFER_CAP = 120;

  /** Feed one media message body (the bytes after the transport's media tag). */
  push(bytes: Uint8Array): void {
    const msg = parseMediaMessage(bytes);
    if (!msg) {
      return;
    }
    const sink = this.sinks.get(msg.streamId);
    if (sink) {
      sink(msg);

      return;
    }
    const buf = this.buffered.get(msg.streamId) ?? [];
    buf.push(msg);
    if (buf.length > MediaRouter.BUFFER_CAP) {
      buf.shift();
    }
    this.buffered.set(msg.streamId, buf);
  }

  /** Attach a consumer to a stream; returns the detach. */
  register(streamId: number, sink: MediaSink): () => void {
    this.sinks.set(streamId, sink);
    const pending = this.buffered.get(streamId);
    this.buffered.delete(streamId);
    for (const msg of pending ?? []) {
      sink(msg);
    }

    return () => {
      if (this.sinks.get(streamId) === sink) {
        this.sinks.delete(streamId);
      }
      this.buffered.delete(streamId);
    };
  }

  /** Drop everything — stream ids belong to one connection, not the next. */
  clear(): void {
    this.sinks.clear();
    this.buffered.clear();
  }
}
