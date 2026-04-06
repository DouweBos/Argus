import { useCallback, useEffect, useRef, useSyncExternalStore } from "react";
import { useIpcEvent } from "./useIpcEvent";
import type { AndroidVideoConfig, AndroidVideoFrame } from "../lib/types";

export interface UseAndroidVideoDecoderResult {
  canvasRef: React.RefObject<HTMLCanvasElement | null>;
  /** True once the first decoded frame has been rendered. */
  isReceiving: boolean;
  /** True once the H.264 config (SPS/PPS) has been received and the decoder is configured. */
  isConfigured: boolean;
  /** Natural video dimensions (for touch coordinate normalization). */
  videoWidth: number;
  videoHeight: number;
}

/**
 * WebCodecs-based H.264 decoder that listens for IPC events from the main
 * process and renders decoded frames to a canvas element.
 */
export function useAndroidVideoDecoder(
  active: boolean,
): UseAndroidVideoDecoderResult {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const decoderRef = useRef<VideoDecoder | null>(null);
  const dimensionsRef = useRef({ width: 0, height: 0 });

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
      setReceiving(false);
      setConfigured(false);
    }
  }, [active, setReceiving, setConfigured]);

  // --- Handle config event: create/configure decoder ---
  useIpcEvent<AndroidVideoConfig>(
    active ? "android_video_config" : "",
    useCallback(
      (config: AndroidVideoConfig) => {
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
            console.error("[VideoDecoder] error:", e.name, e.message);
          },
        });

        // description may arrive as a plain object (structured clone from IPC)
        // — ensure it's a proper Uint8Array
        const description =
          config.description instanceof Uint8Array
            ? config.description
            : new Uint8Array(Object.values(config.description));

        decoder.configure({
          codec: config.codec,
          codedWidth: config.codedWidth,
          codedHeight: config.codedHeight,
          description,
        });

        decoderRef.current = decoder;
        setConfigured(true);
        console.log(
          `[VideoDecoder] configured: ${config.codec} ${String(config.codedWidth)}x${String(config.codedHeight)}`,
        );
      },
      [setReceiving, setConfigured],
    ),
  );

  // --- Handle frame events: decode H.264 access units ---
  useIpcEvent<AndroidVideoFrame>(
    active ? "android_video_frame" : "",
    useCallback((frame: AndroidVideoFrame) => {
      const decoder = decoderRef.current;
      if (!decoder || decoder.state !== "configured") return;

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
      if (decoder.decodeQueueSize > 3) return;

      decoder.decode(chunk);
    }, []),
  );

  return { canvasRef, isReceiving, isConfigured, videoWidth, videoHeight };
}
