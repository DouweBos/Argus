import { useCallback, useRef } from "react";
import styles from "./DeviceStage.module.css";

const DRAG_THROTTLE_MS = 17;

/** Clockwise degrees the stream is rotated by before it is presented. */
export type StreamRotation = 0 | 90 | 180 | 270;

export interface DeviceStageProps {
  /** Input is refused (someone else is driving), so pointers are ignored. */
  blocked?: boolean;
  /** Overlays drawn on top of the picture: claim scrim, driver badge, status. */
  children?: React.ReactNode;
  canvasClassName?: string;
  canvasRef: React.RefObject<HTMLCanvasElement | null>;
  /** Extra classes on the focusable wrapper, for surface-specific layout. */
  className?: string;
  onKeyDown?: (e: React.KeyboardEvent<HTMLDivElement>) => void;
  onKeyUp?: (e: React.KeyboardEvent<HTMLDivElement>) => void;
  /** Normalized, un-rotated point in the stream's own space. */
  onTouch: (x: number, y: number, eventType: number) => void;
  rotation?: StreamRotation;
  videoHeight: number;
  videoWidth: number;
}

/**
 * Undo the presentation rotation, turning a point in the displayed image back
 * into the stream's own coordinate space. Both are normalized to [0, 1].
 */
export function unrotate(
  x: number,
  y: number,
  rotation: StreamRotation,
): { x: number; y: number } {
  switch (rotation) {
    case 90:
      return { x: y, y: 1 - x };
    case 180:
      return { x: 1 - x, y: 1 - y };
    case 270:
      return { x: 1 - y, y: x };
    default:
      return { x, y };
  }
}

/**
 * A live device picture you can drive: the decoder's canvas, presented the way
 * the device is actually being held, with pointer events turned back into the
 * device's own coordinates.
 *
 * The framebuffer is always panel-native, so a device held sideways streams
 * sideways — every surface showing one (desktop runtime view, huddle guest)
 * has to rotate it and un-rotate its touches, so both do it from here.
 */
export function DeviceStage({
  blocked = false,
  canvasClassName,
  canvasRef,
  children,
  className,
  onKeyDown,
  onKeyUp,
  onTouch,
  rotation = 0,
  videoHeight,
  videoWidth,
}: DeviceStageProps) {
  const touchFailed = useRef(false);
  const lastDragTime = useRef(0);
  const isPointerDown = useRef(false);

  const getNormCoords = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const containerRect = e.currentTarget.getBoundingClientRect();
      if (!videoWidth || !videoHeight) {
        return {
          x: (e.clientX - containerRect.left) / containerRect.width,
          y: (e.clientY - containerRect.top) / containerRect.height,
        };
      }

      // A quarter turn presents the stream with its axes swapped, so the
      // on-screen box is fitted from the transposed size.
      const quarterTurn = rotation === 90 || rotation === 270;
      const shownW = quarterTurn ? videoHeight : videoWidth;
      const shownH = quarterTurn ? videoWidth : videoHeight;

      const scale = Math.min(
        containerRect.width / shownW,
        containerRect.height / shownH,
      );
      const renderedW = shownW * scale;
      const renderedH = shownH * scale;
      const offsetX = (containerRect.width - renderedW) / 2;
      const offsetY = (containerRect.height - renderedH) / 2;

      const clamp = (v: number) => Math.max(0, Math.min(0.9999, v));
      const shown = unrotate(
        clamp((e.clientX - containerRect.left - offsetX) / renderedW),
        clamp((e.clientY - containerRect.top - offsetY) / renderedH),
        rotation,
      );

      return { x: clamp(shown.x), y: clamp(shown.y) };
    },
    [videoWidth, videoHeight, rotation],
  );

  const handlePointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (blocked) {
        return;
      }
      touchFailed.current = false;
      isPointerDown.current = true;
      e.currentTarget.setPointerCapture(e.pointerId);
      document.body.classList.add("sim-touching");
      const { x, y } = getNormCoords(e);
      try {
        onTouch(x, y, 0);
      } catch {
        touchFailed.current = true;
      }
    },
    [blocked, getNormCoords, onTouch],
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (
        blocked ||
        !isPointerDown.current ||
        e.buttons === 0 ||
        touchFailed.current
      ) {
        return;
      }
      const now = performance.now();
      if (now - lastDragTime.current < DRAG_THROTTLE_MS) {
        return;
      }
      lastDragTime.current = now;
      const { x, y } = getNormCoords(e);
      try {
        onTouch(x, y, 1);
      } catch {
        touchFailed.current = true;
      }
    },
    [blocked, getNormCoords, onTouch],
  );

  const handlePointerUp = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (blocked || !isPointerDown.current) {
        return;
      }
      isPointerDown.current = false;
      e.currentTarget.releasePointerCapture(e.pointerId);
      document.body.classList.remove("sim-touching");
      const { x, y } = getNormCoords(e);
      onTouch(x, y, 2);
    },
    [blocked, getNormCoords, onTouch],
  );

  return (
    <div
      className={className ? `${styles.body} ${className}` : styles.body}
      tabIndex={0}
      onKeyDown={blocked ? undefined : onKeyDown}
      onKeyUp={blocked ? undefined : onKeyUp}
    >
      <div
        className={styles.container}
        onPointerCancel={handlePointerUp}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
      >
        <canvas
          ref={canvasRef}
          className={
            canvasClassName
              ? `${styles.canvas} ${canvasClassName}`
              : styles.canvas
          }
          data-rotation={rotation}
          height={videoHeight || undefined}
          width={videoWidth || undefined}
        />
        {children}
      </div>
    </div>
  );
}
