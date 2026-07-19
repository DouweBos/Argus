import { useEffect, useRef, useState } from "react";
import { error, log } from "@logger";
import { requestCameraAccess } from "../lib/ipc";

export interface UseVideoInputStreamResult {
  /** Error message if the stream failed to start. */
  errorMsg: string | null;
  /** True once the `<video>` is playing frames. */
  playing: boolean;
  videoRef: React.RefObject<HTMLVideoElement | null>;
}

// Prefer the capture card's full resolution (most are 1080p) rather than the
// low default getUserMedia would otherwise negotiate.
const RESOLUTION = { width: { ideal: 1920 }, height: { ideal: 1080 } };

/** getUserMedia for a specific device, retrying without `exact` if it's gone. */
async function openStream(deviceId: string): Promise<MediaStream> {
  try {
    return await navigator.mediaDevices.getUserMedia({
      video: { deviceId: { exact: deviceId }, ...RESOLUTION },
      audio: false,
    });
  } catch (e) {
    if (e instanceof Error && e.name === "OverconstrainedError") {
      // deviceId changed (e.g. after permission was first granted) — fall back
      // to a soft preference so the picture still comes up.
      return navigator.mediaDevices.getUserMedia({
        video: { deviceId, ...RESOLUTION },
        audio: false,
      });
    }
    throw e;
  }
}

/**
 * Streams a `videoinput` device (capture card / camera) into a `<video>` via
 * getUserMedia. View-only — no control. Tracks are stopped on unmount / change.
 */
export function useVideoInputStream(
  deviceId: string | null,
  active: boolean,
): UseVideoInputStreamResult {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [playing, setPlaying] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    const el = videoRef.current;
    if (!active || !deviceId || !el) {
      return;
    }

    let stream: MediaStream | null = null;
    let cancelled = false;
    const onPlaying = () => setPlaying(true);
    const onEmptied = () => setPlaying(false);
    el.addEventListener("playing", onPlaying);
    el.addEventListener("emptied", onEmptied);

    const start = async () => {
      // Best-effort macOS TCC check — never let it block the stream. If access
      // is denied/restricted, getUserMedia below reports the real error.
      try {
        // Long timeout — the macOS prompt (first run) can sit until answered.
        const status = await Promise.race([
          requestCameraAccess(),
          new Promise<string>((r) => setTimeout(() => r("timeout"), 30000)),
        ]);
        log(`[video] camera access: ${status}`);
      } catch (e) {
        log(`[video] camera access check failed (continuing): ${String(e)}`);
      }
      if (cancelled) {
        return;
      }

      try {
        log(`[video] getUserMedia for ${deviceId}`);
        stream = await openStream(deviceId);
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());

          return;
        }
        log(
          `[video] stream acquired (${stream.getVideoTracks().length} track)`,
        );
        el.srcObject = stream;
        el.play().catch(() => {
          // Autoplay may reject transiently; the element keeps the stream.
        });
      } catch (e) {
        if (cancelled) {
          return;
        }
        error("[video] getUserMedia failed:", e);
        setErrorMsg(e instanceof Error ? `${e.name}: ${e.message}` : String(e));
      }
    };

    start().catch(() => {
      // start() handles its own errors; nothing should escape.
    });

    return () => {
      cancelled = true;
      el.removeEventListener("playing", onPlaying);
      el.removeEventListener("emptied", onEmptied);
      stream?.getTracks().forEach((t) => t.stop());
      el.srcObject = null;
    };
  }, [deviceId, active]);

  return { videoRef, playing, errorMsg };
}
