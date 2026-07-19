import type { AndroidVideoConfig, AndroidVideoFrame } from "../lib/types";
import { useCallback, useEffect, useRef, useSyncExternalStore } from "react";
import { error, log } from "@logger";
import { useIpcEvent } from "./useIpcEvent";

export interface UseAndroidVideoDecoderResult {
  canvasRef: React.RefObject<HTMLCanvasElement | null>;
  /** True once the H.264 config (SPS/PPS) has been received and the decoder is configured. */
  isConfigured: boolean;
  /** True once the first decoded frame has been rendered. */
  isReceiving: boolean;
  videoHeight: number;
  /** Natural video dimensions (for touch coordinate normalization). */
  videoWidth: number;
}

/**
 * WebCodecs-based H.264 decoder that listens for IPC events from the main
 * process and renders decoded frames to a canvas element.
 *
 * The IPC channel names are parameterized so the same decode path serves both
 * the Android bridge (default) and the iOS/tvOS bridge — see
 * {@link useIosVideoDecoder}.
 */
export function useAndroidVideoDecoder(
  active: boolean,
  configEvent = "android_video_config",
  frameEvent = "android_video_frame",
): UseAndroidVideoDecoderResult {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const decoderRef = useRef<VideoDecoder | null>(null);
  const dimensionsRef = useRef({ width: 0, height: 0 });
  // Identity of the currently-applied config. The parser re-emits config before
  // every keyframe (for late joiners); recreating the decoder + clearing the
  // canvas each time causes a periodic blank flash, so we ignore configs that
  // match what the live decoder is already using.
  const configKeyRef = useRef<string | null>(null);
  // WebCodecs requires the first chunk after configure() to be a keyframe, and
  // a delta can't decode without its reference frame. Drop deltas until the
  // next keyframe (after configure, or to resync after a decode error).
  const awaitingKeyframeRef = useRef(true);

  // --- isReceiving via useSyncExternalStore ---
  const receivingRef = useRef(false);
  const listenersRef = useRef(new Set<() => void>());

  const subscribe = useCallback((cb: () => void) => {
    listenersRef.current.add(cb);

    return () => {
      listenersRef.current.delete(cb);
    };
  }, []);

  const getSnapshot = useCallback(() => receivingRef.current, []);

  const setReceiving = useCallback((value: boolean) => {
    if (receivingRef.current !== value) {
      receivingRef.current = value;
      listenersRef.current.forEach((cb) => cb());
    }
  }, []);

  const isReceiving = useSyncExternalStore(subscribe, getSnapshot);

  // --- isConfigured via useSyncExternalStore ---
  const configuredRef = useRef(false);
  const configuredListenersRef = useRef(new Set<() => void>());

  const subscribeConfigured = useCallback((cb: () => void) => {
    configuredListenersRef.current.add(cb);

    return () => {
      configuredListenersRef.current.delete(cb);
    };
  }, []);

  const getConfiguredSnapshot = useCallback(() => configuredRef.current, []);

  const setConfigured = useCallback((value: boolean) => {
    if (configuredRef.current !== value) {
      configuredRef.current = value;
      configuredListenersRef.current.forEach((cb) => cb());
    }
  }, []);

  const isConfigured = useSyncExternalStore(
    subscribeConfigured,
    getConfiguredSnapshot,
  );

  // --- videoWidth / videoHeight ---
  const videoWidthRef = useRef(0);
  const videoHeightRef = useRef(0);
  const dimsListenersRef = useRef(new Set<() => void>());

  const subscribeDims = useCallback((cb: () => void) => {
    dimsListenersRef.current.add(cb);

    return () => {
      dimsListenersRef.current.delete(cb);
    };
  }, []);

  const getWidth = useCallback(() => videoWidthRef.current, []);
  const getHeight = useCallback(() => videoHeightRef.current, []);

  const videoWidth = useSyncExternalStore(subscribeDims, getWidth);
  const videoHeight = useSyncExternalStore(subscribeDims, getHeight);

  // --- Cleanup decoder on deactivation ---
  useEffect(() => {
    if (!active) {
      if (decoderRef.current?.state !== "closed") {
        decoderRef.current?.close();
      }

      decoderRef.current = null;
      configKeyRef.current = null;
      awaitingKeyframeRef.current = true;
      setReceiving(false);
      setConfigured(false);
    }
  }, [active, setReceiving, setConfigured]);

  // --- Handle config event: create/configure decoder ---
  useIpcEvent<AndroidVideoConfig>(
    active ? configEvent : "",
    useCallback(
      (config: AndroidVideoConfig) => {
        // description may arrive as a plain object (structured clone from IPC)
        // — ensure it's a proper Uint8Array
        const description =
          config.description instanceof Uint8Array
            ? config.description
            : new Uint8Array(Object.values(config.description));

        // Ignore identical re-emitted configs (sent before every keyframe):
        // tearing down the decoder and clearing the canvas on each one causes a
        // periodic blank flash. Only (re)configure on a real change.
        const configKey = `${config.codec}|${String(config.codedWidth)}x${String(config.codedHeight)}|${String(description.length)}|${Array.from(description.subarray(0, 16)).join(",")}`;
        if (
          decoderRef.current?.state === "configured" &&
          configKeyRef.current === configKey
        ) {
          return;
        }
        configKeyRef.current = configKey;

        // Close previous decoder if any
        if (decoderRef.current?.state !== "closed") {
          decoderRef.current?.close();
        }

        dimensionsRef.current = {
          width: config.codedWidth,
          height: config.codedHeight,
        };
        videoWidthRef.current = config.codedWidth;
        videoHeightRef.current = config.codedHeight;
        dimsListenersRef.current.forEach((cb) => cb());

        const canvas = canvasRef.current;
        if (canvas) {
          canvas.width = config.codedWidth;
          canvas.height = config.codedHeight;
        }

        const decoder = new VideoDecoder({
          output: (frame: VideoFrame) => {
            const cvs = canvasRef.current;
            if (!cvs) {
              frame.close();

              return;
            }

            // Resize canvas if needed (e.g. rotation)
            if (
              cvs.width !== frame.displayWidth ||
              cvs.height !== frame.displayHeight
            ) {
              cvs.width = frame.displayWidth;
              cvs.height = frame.displayHeight;
              videoWidthRef.current = frame.displayWidth;
              videoHeightRef.current = frame.displayHeight;
              dimsListenersRef.current.forEach((cb) => cb());
            }

            const ctx = cvs.getContext("2d");
            if (ctx) {
              ctx.drawImage(frame, 0, 0);
            }

            frame.close();
            setReceiving(true);
          },
          error: (e: DOMException) => {
            error("[VideoDecoder] error:", e.name, e.message);
          },
        });

        decoder.configure({
          codec: config.codec,
          codedWidth: config.codedWidth,
          codedHeight: config.codedHeight,
          description,
        });

        decoderRef.current = decoder;
        awaitingKeyframeRef.current = true;
        setConfigured(true);
        log(
          `[VideoDecoder] configured: ${config.codec} ${String(config.codedWidth)}x${String(config.codedHeight)}`,
        );
      },
      [setReceiving, setConfigured],
    ),
  );

  // --- Handle frame events: decode H.264 access units ---
  useIpcEvent<AndroidVideoFrame>(
    active ? frameEvent : "",
    useCallback((frame: AndroidVideoFrame) => {
      const decoder = decoderRef.current;
      if (!decoder || decoder.state !== "configured") {
        return;
      }

      // The decoder can only start (or resync) on a keyframe — drop deltas
      // until one arrives, otherwise decode() throws "a key frame is required".
      if (awaitingKeyframeRef.current) {
        if (!frame.keyFrame) {
          return;
        }
        awaitingKeyframeRef.current = false;
      }

      // data may arrive as a plain object from structured clone
      const data =
        frame.data instanceof Uint8Array
          ? frame.data
          : new Uint8Array(Object.values(frame.data));

      const chunk = new EncodedVideoChunk({
        type: frame.keyFrame ? "key" : "delta",
        timestamp: frame.timestamp,
        data,
      });

      // Drop frames if decoder queue gets too deep
      if (decoder.decodeQueueSize > 3) {
        return;
      }

      try {
        decoder.decode(chunk);
      } catch {
        // Bad state (e.g. delta without a valid reference) — wait for the next
        // keyframe to resync instead of throwing an uncaught error.
        awaitingKeyframeRef.current = true;
      }
    }, []),
  );

  return { canvasRef, isReceiving, isConfigured, videoWidth, videoHeight };
}
