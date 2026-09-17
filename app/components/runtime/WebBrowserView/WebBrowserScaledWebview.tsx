import { useCallback, useRef } from "react";
import { useBrowserStream } from "../../../hooks/useBrowserStream";
import styles from "./WebBrowserView.module.css";

const DRAG_THROTTLE_MS = 17;

interface Props {
  internalHeight: number;
  internalWidth: number;
  onKeyboardEvent: (type: "down" | "press" | "up", key: string) => void;
  onMouseEvent: (
    type: "click" | "down" | "move" | "up",
    x: number,
    y: number,
    button?: "left" | "middle" | "right",
  ) => void;
  onWheelEvent: (x: number, y: number, deltaX: number, deltaY: number) => void;
  sessionId: string;
}

/**
 * Renders the embedded browser's live picture and captures pointer/keyboard
 * events, forwarding them to the backend as viewport-pixel coordinates.
 *
 * Mirrors the iOS simulator's IosDeviceStreamView pattern: an `<img>` element
 * with `object-fit: contain` handles display scaling; a pointer overlay
 * converts display coordinates to the browser's viewport coordinate space.
 */
export function WebBrowserScaledWebview({
  internalHeight,
  internalWidth,
  onKeyboardEvent,
  onMouseEvent,
  onWheelEvent,
  sessionId,
}: Props) {
  const { imgRef, isReceiving, streamUrl } = useBrowserStream(sessionId, true);

  const lastDragTime = useRef(0);
  const isPointerDown = useRef(false);

  /** Convert display coordinates to viewport pixels. */
  const toViewport = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const img = imgRef.current;
      const containerRect = e.currentTarget.getBoundingClientRect();

      const naturalW = img?.naturalWidth || internalWidth;
      const naturalH = img?.naturalHeight || internalHeight;
      const scale = Math.min(
        containerRect.width / naturalW,
        containerRect.height / naturalH,
      );
      const renderedW = naturalW * scale;
      const renderedH = naturalH * scale;
      const offsetX = (containerRect.width - renderedW) / 2;
      const offsetY = (containerRect.height - renderedH) / 2;

      return {
        x: Math.max(
          0,
          Math.min(
            naturalW - 1,
            ((e.clientX - containerRect.left - offsetX) / renderedW) * naturalW,
          ),
        ),
        y: Math.max(
          0,
          Math.min(
            naturalH - 1,
            ((e.clientY - containerRect.top - offsetY) / renderedH) * naturalH,
          ),
        ),
      };
    },
    [imgRef, internalWidth, internalHeight],
  );

  const handlePointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      isPointerDown.current = true;
      e.currentTarget.setPointerCapture(e.pointerId);
      const { x, y } = toViewport(e);
      onMouseEvent("down", x, y, "left");
    },
    [toViewport, onMouseEvent],
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!isPointerDown.current || e.buttons === 0) {
        return;
      }
      const now = performance.now();
      if (now - lastDragTime.current < DRAG_THROTTLE_MS) {
        return;
      }
      lastDragTime.current = now;
      const { x, y } = toViewport(e);
      onMouseEvent("move", x, y);
    },
    [toViewport, onMouseEvent],
  );

  const handlePointerUp = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      isPointerDown.current = false;
      e.currentTarget.releasePointerCapture(e.pointerId);
      const { x, y } = toViewport(e);
      onMouseEvent("up", x, y, "left");
    },
    [toViewport, onMouseEvent],
  );

  const handleWheel = useCallback(
    (e: React.WheelEvent<HTMLDivElement>) => {
      const { x, y } = toViewport(
        e as unknown as React.PointerEvent<HTMLDivElement>,
      );
      onWheelEvent(x, y, e.deltaX, e.deltaY);
    },
    [toViewport, onWheelEvent],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      e.preventDefault();
      onKeyboardEvent("down", e.key);
    },
    [onKeyboardEvent],
  );

  const handleKeyUp = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      e.preventDefault();
      onKeyboardEvent("up", e.key);
    },
    [onKeyboardEvent],
  );

  return (
    <div
      className={styles.browserStreamBody}
      tabIndex={0}
      onContextMenu={(e) => e.preventDefault()}
      onKeyDown={handleKeyDown}
      onKeyUp={handleKeyUp}
    >
      <div
        className={styles.browserCanvasContainer}
        onPointerCancel={handlePointerUp}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onWheel={handleWheel}
      >
        <img
          ref={imgRef}
          alt="Web browser"
          className={styles.browserCanvas}
          draggable={false}
          src={streamUrl ?? undefined}
        />
        {!isReceiving && (
          <div className={styles.browserConnecting}>
            <p>Waiting for frames...</p>
          </div>
        )}
      </div>
    </div>
  );
}
