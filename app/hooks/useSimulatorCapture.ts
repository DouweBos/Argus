import { useRef, useCallback, useSyncExternalStore, useEffect } from "react";

/**
 * Connects to the local MJPEG server and returns an img ref for rendering.
 * The browser natively handles MJPEG streams via `<img src>`.
 * Auto-retries on connection errors (up to 5 attempts).
 */
export function useSimulatorCapture(mjpegPort: null | number) {
  const imgRef = useRef<HTMLImageElement>(null);
  const receivingRef = useRef(false);
  const listenersRef = useRef(new Set<() => void>());
  const retryCountRef = useRef(0);
  const retryTimerRef = useRef<null | ReturnType<typeof setTimeout>>(null);

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

  const streamUrl = mjpegPort
    ? `http://127.0.0.1:${mjpegPort}/stream.mjpeg`
    : null;

  useEffect(() => {
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
    if (!img) return;

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
