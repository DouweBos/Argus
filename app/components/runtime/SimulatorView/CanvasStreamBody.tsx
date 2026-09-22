import type { DeviceClaimState } from "../../../hooks/useDeviceClaim";
import { useCallback, useRef } from "react";
import { DeviceControlOverlay } from "@argus/peacock";
import { DeviceDriverBadge } from "@argus/peacock";
import { useSharedDeviceDrivers } from "../../../hooks/useSharedDeviceDrivers";
import styles from "./RuntimeView.module.css";

const DRAG_THROTTLE_MS = 17;

/** Clockwise degrees the stream is rotated by before it is presented. */
export type StreamRotation = 0 | 90 | 180 | 270;

interface CanvasStreamBodyProps {
  canvasRef: React.RefObject<HTMLCanvasElement | null>;
  /** Input arbitration on the host. Omitted where nothing can contend for it. */
  claim?: DeviceClaimState;
  /**
   * The device this is a picture of, so a shared one can say who is driving.
   * Omitted where there is nothing to share (a preview, a test harness).
   */
  deviceKey?: string | null;
  /** Whether the decoder has received its H.264 config (SPS/PPS). */
  isConfigured: boolean;
  isReceiving: boolean;
  onKeyDown: (e: React.KeyboardEvent<HTMLDivElement>) => void;
  onKeyUp: (e: React.KeyboardEvent<HTMLDivElement>) => void;
  onTouch: (x: number, y: number, eventType: number) => void;
  /** Clockwise rotation applied to the canvas; touches are un-rotated to match. */
  rotation?: StreamRotation;
  videoHeight: number;
  videoWidth: number;
}

/**
 * Undo the presentation rotation, turning a point in the displayed image back
 * into the stream's own coordinate space. Both are normalized to [0, 1].
 */
function unrotate(
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
 * Wraps a `<canvas>` with pointer event handling for touch coordinate
 * normalization. Mirrors the pointer logic from IosDeviceStreamView but
 * uses explicit video dimensions instead of `img.naturalWidth/Height`.
 */
export function CanvasStreamBody({
  canvasRef,
  claim,
  deviceKey,
  videoWidth,
  videoHeight,
  isReceiving,
  isConfigured,
  onTouch,
  onKeyDown,
  onKeyUp,
  rotation = 0,
}: CanvasStreamBodyProps) {
  const blocked = claim?.blocked ?? false;
  const takeControl = claim?.takeControl;
  const drivers = useSharedDeviceDrivers(deviceKey ?? null);
  const handleTakeControl = useCallback(() => takeControl?.(), [takeControl]);
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
      if (blocked) {
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
      className={styles.streamBody}
      tabIndex={0}
      onKeyDown={blocked ? undefined : onKeyDown}
      onKeyUp={blocked ? undefined : onKeyUp}
    >
      <div
        className={styles.canvasContainer}
        onPointerCancel={handlePointerUp}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
      >
        <canvas
          ref={canvasRef}
          className={styles.canvas}
          data-rotation={rotation}
          height={videoHeight || undefined}
          width={videoWidth || undefined}
        />
        {claim && (
          <DeviceControlOverlay
            holderLabel={claim.holderLabel}
            onTakeControl={handleTakeControl}
          />
        )}
        {/* Awareness, not arbitration — this never blocks the pointer. */}
        <DeviceDriverBadge
          holderLabel={drivers.holderLabel}
          waitingLabels={drivers.waitingLabels}
        />
        {!isReceiving && (
          <div className={styles.connecting}>
            <p>
              {!isConfigured
                ? "Connecting to device..."
                : "Decoding first frame..."}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
