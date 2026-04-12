import {
  useCallback,
  useLayoutEffect,
  useRef,
  useSyncExternalStore,
} from "react";

/**
 * Connects to an MJPEG stream and returns an img ref for rendering.
 * The browser natively handles MJPEG streams via `<img src>`.
 * Auto-retries on connection errors (up to 5 attempts).
 *
 * Accepts either a port (builds `http://127.0.0.1:{port}/stream.mjpeg`) or a
 * full stream URL for custom endpoints like the web browser MJPEG server.
 */
export function useSimulatorCapture(mjpegPortOrUrl: number | string | null) {
  const imgRef = useRef<HTMLImageElement>(null);
  const receivingRef = useRef(false);
  const listenersRef = useRef(new Set<() => void>());
  const retryCountRef = useRef(0);
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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

  let streamUrl: string | null = null;
  if (typeof mjpegPortOrUrl === "string") {
    streamUrl = mjpegPortOrUrl;
  } else if (mjpegPortOrUrl) {
    streamUrl = `http://127.0.0.1:${mjpegPortOrUrl}/stream.mjpeg`;
  }

  useLayoutEffect(() => {
    retryCountRef.current = 0;
    if (retryTimerRef.current) {
      clearTimeout(retryTimerRef.current);
      retryTimerRef.current = null;
    }

    if (!streamUrl) {
      setReceiving(false);

      return;
    }

    const img = imgRef.current;
    if (!img) {
      return;
    }

    const handleLoad = () => {
      retryCountRef.current = 0;
      setReceiving(true);
    };

    const handleError = () => {
      setReceiving(false);
      if (retryCountRef.current < 5 && streamUrl) {
        retryCountRef.current++;
        retryTimerRef.current = setTimeout(() => {
          const el = imgRef.current;
          if (el) {
            el.src = `${streamUrl}?t=${Date.now()}`;
          }
        }, 500);
      }
    };

    img.addEventListener("load", handleLoad);
    img.addEventListener("error", handleError);

    // The img src is set via JSX before this effect runs. If the local
    // MJPEG server responded fast enough, the first frame may have already
    // arrived and the `load` event already fired — catch that case here.
    if (img.complete && img.naturalWidth > 0) {
      handleLoad();
    }

    return () => {
      img.removeEventListener("load", handleLoad);
      img.removeEventListener("error", handleError);
      if (retryTimerRef.current) {
        clearTimeout(retryTimerRef.current);
        retryTimerRef.current = null;
      }
    };
  }, [streamUrl, setReceiving]);

  return { imgRef, streamUrl, isReceiving };
}
