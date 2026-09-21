import { useEffect, useRef, useState } from "react";
import { browserGetMjpegPort } from "../lib/ipc";
import { useRouteHostId } from "../lib/routeHooks";
import { getTransportFor } from "../lib/transport";
import { subjectHostId } from "../lib/transport/hostRouting";
import { useHostConnection } from "../stores/connectionStore";
import { useSimulatorCapture } from "./useSimulatorCapture";

export interface UseBrowserStreamResult {
  imgRef: React.RefObject<HTMLImageElement | null>;
  /** True once a frame has been painted. */
  isReceiving: boolean;
  /** Local mode's MJPEG URL; null in remote mode, where frames are pushed. */
  streamUrl: string | null;
}

/**
 * Live picture of an embedded browser session, from whichever machine runs it.
 *
 * Two sources, one `<img>`. Locally the host's MJPEG server serves the frames
 * over a localhost URL. Attached to another host that URL points at the wrong
 * machine, so remote mode claims the stream with `browser.watch` and paints the
 * JPEGs the gateway pushes down its binary media channel instead. The source is
 * feature-detected the same way device video does it: a transport with a media
 * channel is a remote one.
 */
export function useBrowserStream(
  sessionId: string | null,
  active: boolean,
): UseBrowserStreamResult {
  const routeHostId = useRouteHostId();
  // The browser belongs to its session's host — not to whichever host the
  // window happens to be focused on, so two attached hosts can't cross-talk.
  const hostId = subjectHostId({ sessionId: sessionId ?? "" }) ?? routeHostId;
  const on = active && !!sessionId;
  const media = on ? (getTransportFor(hostId).media ?? null) : null;
  const connectionState = useHostConnection(hostId)?.state ?? "ready";

  const [mjpegPort, setMjpegPort] = useState<number | null>(null);
  const [remoteReceiving, setRemoteReceiving] = useState(false);

  // Local only: the port is this machine's, and means nothing to a remote host.
  useEffect(() => {
    if (!on || media) {
      return;
    }
    let cancelled = false;
    browserGetMjpegPort()
      .then((port) => {
        if (!cancelled && port > 0) {
          setMjpegPort(port);
        }
      })
      .catch(() => undefined);

    return () => {
      cancelled = true;
    };
  }, [on, media]);

  const localUrl =
    on && !media && mjpegPort && sessionId
      ? `http://127.0.0.1:${mjpegPort}/stream/${encodeURIComponent(sessionId)}`
      : null;
  const { imgRef, isReceiving: localReceiving } = useSimulatorCapture(localUrl);

  const objectUrlRef = useRef<string | null>(null);

  useEffect(() => {
    if (!on || !media || !sessionId || connectionState !== "ready") {
      return;
    }
    let cancelled = false;
    let unregister: (() => void) | null = null;
    const transport = getTransportFor(hostId);
    const release = () => {
      transport
        .invoke("browser.unwatch", { session_id: sessionId })
        .catch(() => undefined);
    };

    transport
      .invoke<{ stream_id: number }>("browser.watch", {
        session_id: sessionId,
      })
      .then(({ stream_id }) => {
        if (cancelled) {
          release();

          return;
        }
        unregister = media.register(stream_id, (msg) => {
          if (msg.kind !== "jpeg" || !imgRef.current) {
            return;
          }
          const url = URL.createObjectURL(
            new Blob([msg.data as BlobPart], { type: "image/jpeg" }),
          );
          const previous = objectUrlRef.current;
          objectUrlRef.current = url;
          imgRef.current.src = url;
          if (previous) {
            URL.revokeObjectURL(previous);
          }
          setRemoteReceiving(true);
        });
      })
      .catch(() => undefined);

    return () => {
      cancelled = true;
      unregister?.();
      release();
      setRemoteReceiving(false);
      if (objectUrlRef.current) {
        URL.revokeObjectURL(objectUrlRef.current);
        objectUrlRef.current = null;
      }
    };
    // `connectionState` is a dependency on purpose: a reconnect invalidates the
    // host's stream id, so the watch has to be re-established.
  }, [on, media, sessionId, hostId, connectionState, imgRef]);

  return {
    imgRef,
    isReceiving: media ? remoteReceiving : localReceiving,
    streamUrl: localUrl,
  };
}
