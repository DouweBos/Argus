/**
 * A session's embedded browser, view-only: `browser.watch` streams its
 * screencast as JPEGs down the media channel, painted onto a canvas. Over the
 * gateway nobody but the computer drives it, so the stage takes no input.
 */

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { DeviceStage, EmptyState, Icons, Spinner } from "@argus/peacock";
import { request } from "../lib/request";
import { capture } from "../telemetry/telemetry";
import { currentTransport, media, useConnectionStore } from "../stores/connection";

/** No frame by then: the session most likely has no browser open. */
export const NO_BROWSER_TIMEOUT_MS = 8_000;

type Status = "empty" | "streaming" | "waiting";

const noTouch = () => {};

export default function BrowserScreen({ sessionId }: { sessionId: string }) {
  const connection = useConnectionStore((s) => s.connection);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const lastFrame = useRef<ImageBitmap | null>(null);
  const [dims, setDims] = useState({ width: 0, height: 0 });
  const [status, setStatus] = useState<Status>("waiting");
  const reported = useRef(false);

  // Once per screen open: the first frame, or the wait giving up.
  const report = useCallback((streaming: boolean) => {
    if (!reported.current) {
      reported.current = true;
      capture("web_browser_viewed", { streaming });
    }
  }, []);

  const paint = useCallback((frame: ImageBitmap) => {
    const ctx = canvasRef.current?.getContext("2d");
    ctx?.drawImage(frame, 0, 0);
  }, []);

  // A resize clears the canvas, and a still page may send no next frame.
  useLayoutEffect(() => {
    if (lastFrame.current) {
      paint(lastFrame.current);
    }
  }, [dims, paint]);

  useEffect(() => {
    const t = currentTransport();
    if (connection !== "ready" || !t) {
      return;
    }
    let cancelled = false;
    let unregister: (() => void) | null = null;
    // One decode at a time; a frame that lands meanwhile replaces the queued one.
    let decoding = false;
    let queued: Uint8Array | null = null;
    setStatus((s) => (s === "streaming" ? s : "waiting"));
    const watchdog = setTimeout(() => {
      setStatus((s) => (s === "waiting" ? "empty" : s));
      report(false);
    }, NO_BROWSER_TIMEOUT_MS);

    const decode = (data: Uint8Array) => {
      decoding = true;
      createImageBitmap(new Blob([data as BlobPart], { type: "image/jpeg" }))
        .then((frame) => {
          if (cancelled) {
            frame.close();

            return;
          }
          lastFrame.current?.close();
          lastFrame.current = frame;
          setDims((d) =>
            d.width === frame.width && d.height === frame.height
              ? d
              : { width: frame.width, height: frame.height },
          );
          paint(frame);
          setStatus("streaming");
          report(true);
        })
        .catch(() => {})
        .finally(() => {
          decoding = false;
          const next = queued;
          queued = null;
          if (next && !cancelled) {
            decode(next);
          }
        });
    };

    request(t, "browser.watch", { session_id: sessionId })
      .then(({ stream_id }) => {
        if (cancelled) {
          request(t, "browser.unwatch", { session_id: sessionId }).catch(
            () => {},
          );

          return;
        }
        unregister = media.register(stream_id, (msg) => {
          if (msg.kind !== "jpeg") {
            return;
          }
          if (decoding) {
            queued = msg.data;
          } else {
            decode(msg.data);
          }
        });
      })
      .catch(() => {
        // A session with no browser may refuse the watch outright.
        if (!cancelled) {
          setStatus((s) => (s === "streaming" ? s : "empty"));
        }
      });

    return () => {
      cancelled = true;
      clearTimeout(watchdog);
      unregister?.();
      request(t, "browser.unwatch", { session_id: sessionId }).catch(() => {});
    };
  }, [connection, sessionId, paint, report]);

  useEffect(
    () => () => {
      lastFrame.current?.close();
      lastFrame.current = null;
    },
    [],
  );

  return (
    <div className="aw-device">
      <DeviceStage
        blocked
        canvasRef={canvasRef}
        className="aw-device-frame"
        videoHeight={dims.height}
        videoWidth={dims.width}
        onTouch={noTouch}
      >
        {status !== "streaming" && (
          <div className="aw-device-placeholder">
            {status === "waiting" ? (
              <Spinner />
            ) : (
              <EmptyState
                icon={<Icons.WebIcon size={22} />}
                title="No browser open in this session"
                body="When an agent opens the session's browser in Argus on your computer, it shows up here."
              />
            )}
          </div>
        )}
      </DeviceStage>
    </div>
  );
}
