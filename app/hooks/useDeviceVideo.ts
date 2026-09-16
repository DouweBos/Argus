import type { AndroidVideoConfig, AndroidVideoFrame } from "../lib/types";
import { useCallback, useEffect, useRef, useState } from "react";
import { H264CanvasDecoder } from "@argus/remote-client";
import { getTransport } from "../lib/transport";
import { useConnection } from "../stores/connectionStore";
import { useIpcEvent } from "./useIpcEvent";

/** The two platforms that produce an H.264 device stream. */
export type VideoPlatform = "android" | "ios";

export interface UseDeviceVideoResult {
  canvasRef: React.RefObject<HTMLCanvasElement | null>;
  /** True once the H.264 config (SPS/PPS) has been applied to the decoder. */
  isConfigured: boolean;
  /** True once the first decoded frame has been rendered. */
  isReceiving: boolean;
  videoHeight: number;
  /** Natural video dimensions (for touch coordinate normalization). */
  videoWidth: number;
}

/** IPC payloads cross structured clone as plain objects in some paths. */
function toBytes(value: Record<string, number> | Uint8Array): Uint8Array {
  return value instanceof Uint8Array
    ? value
    : new Uint8Array(Object.values(value));
}

/**
 * Live device screen for the runtime panel, decoded to a canvas with WebCodecs.
 *
 * Two sources, one decoder. Locally the frames arrive as `<platform>_video_*`
 * IPC events. Attached to a host they ride the gateway's binary TAG_MEDIA
 * channel instead — deliberately not the forwarded event path, which would send
 * every frame twice — so remote mode claims the stream with `devices.watch` and
 * drives the same decoder from it. Nothing above this hook knows the difference.
 */
export function useDeviceVideo(
  active: boolean,
  deviceId: string | null,
  platform: VideoPlatform,
): UseDeviceVideoResult {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const decoderRef = useRef<H264CanvasDecoder | null>(null);
  const attachedRef = useRef<HTMLCanvasElement | null>(null);
  const [isConfigured, setIsConfigured] = useState(false);
  const [isReceiving, setIsReceiving] = useState(false);
  const [dims, setDims] = useState({ width: 0, height: 0 });

  const on = active && !!deviceId;
  // Remote mode only — `media` is unset on the local transport.
  const media = on ? (getTransport().media ?? null) : null;
  const connectionState = useConnection().state;

  useEffect(() => {
    if (!on) {
      return;
    }
    const decoder = new H264CanvasDecoder({
      onDimensions: (width, height) =>
        setDims((d) =>
          d.width === width && d.height === height ? d : { width, height },
        ),
      onFirstFrame: () => setIsReceiving(true),
      onConfigured: setIsConfigured,
    });
    decoder.attachCanvas(canvasRef.current);
    attachedRef.current = canvasRef.current;
    decoderRef.current = decoder;

    return () => {
      decoder.close();
      decoderRef.current = null;
      attachedRef.current = null;
      setIsConfigured(false);
      setIsReceiving(false);
    };
  }, [on, deviceId, platform]);

  // The canvas can mount after the decoder (tvOS renders it inside a custom
  // stream body), and frames drawn before it exists are lost.
  useEffect(() => {
    if (decoderRef.current && attachedRef.current !== canvasRef.current) {
      attachedRef.current = canvasRef.current;
      decoderRef.current.attachCanvas(canvasRef.current);
    }
  });

  // --- Remote: claim the host's stream and pull it off TAG_MEDIA ---
  useEffect(() => {
    if (!on || !media || !deviceId || connectionState !== "ready") {
      return;
    }
    let cancelled = false;
    let unregister: (() => void) | null = null;
    const release = () => {
      getTransport()
        .invoke("devices.unwatch", { device_id: deviceId })
        .catch(() => undefined);
    };

    getTransport()
      .invoke<{ stream_id: number }>("devices.watch", {
        device_id: deviceId,
        platform,
      })
      .then(({ stream_id }) => {
        if (cancelled) {
          release();

          return;
        }
        unregister = media.register(stream_id, (msg) => {
          const decoder = decoderRef.current;
          if (!decoder) {
            return;
          }
          if (msg.kind === "config") {
            decoder.configure(
              msg.codec,
              msg.codedWidth,
              msg.codedHeight,
              msg.description,
            );
          } else {
            decoder.decode(msg.data, msg.keyFrame, msg.timestamp);
          }
        });
      })
      .catch(() => undefined);

    return () => {
      cancelled = true;
      unregister?.();
      release();
    };
    // `connectionState` is a dependency on purpose: a reconnect invalidates the
    // host's stream id, so the watch has to be re-established.
  }, [on, media, deviceId, platform, connectionState]);

  // --- Local: the main process broadcasts config and frames per device ---
  const ipcActive = on && !media;
  const channel = (kind: "config" | "frame") =>
    ipcActive ? `${platform}_video_${kind}:${deviceId ?? ""}` : "";

  useIpcEvent<AndroidVideoConfig>(
    channel("config"),
    useCallback((config: AndroidVideoConfig) => {
      decoderRef.current?.configure(
        config.codec,
        config.codedWidth,
        config.codedHeight,
        toBytes(config.description),
      );
    }, []),
  );

  useIpcEvent<AndroidVideoFrame>(
    channel("frame"),
    useCallback((frame: AndroidVideoFrame) => {
      decoderRef.current?.decode(
        toBytes(frame.data),
        frame.keyFrame,
        frame.timestamp,
      );
    }, []),
  );

  return {
    canvasRef,
    isReceiving,
    isConfigured,
    videoWidth: dims.width,
    videoHeight: dims.height,
  };
}
