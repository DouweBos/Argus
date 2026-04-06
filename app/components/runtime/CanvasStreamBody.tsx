import { useCallback, useRef } from "react";
import styles from "./SimulatorView.module.css";

const DRAG_THROTTLE_MS = 17;

interface CanvasStreamBodyProps {
  canvasRef: React.RefObject<HTMLCanvasElement | null>;
  videoWidth: number;
  videoHeight: number;
  isReceiving: boolean;
  /** Whether the decoder has received its H.264 config (SPS/PPS). */
  isConfigured: boolean;
  onTouch: (x: number, y: number, eventType: number) => void;
  onKeyDown: (e: React.KeyboardEvent<HTMLDivElement>) => void;
  onKeyUp: (e: React.KeyboardEvent<HTMLDivElement>) => void;
}

/**
 * Wraps a `<canvas>` with pointer event handling for touch coordinate
 * normalization. Mirrors the pointer logic from DeviceStreamView but
 * uses explicit video dimensions instead of `img.naturalWidth/Height`.
 */
export function CanvasStreamBody({
  canvasRef,
  videoWidth,
  videoHeight,
  isReceiving,
  isConfigured,
  onTouch,
  onKeyDown,
  onKeyUp,
}: CanvasStreamBodyProps) {
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
      const scale = Math.min(
        containerRect.width / videoWidth,
        containerRect.height / videoHeight,
      );
      const renderedW = videoWidth * scale;
      const renderedH = videoHeight * scale;
      const offsetX = (containerRect.width - renderedW) / 2;
      const offsetY = (containerRect.height - renderedH) / 2;

      return {
        x: Math.max(
          0,
          Math.min(
            0.9999,
            (e.clientX - containerRect.left - offsetX) / renderedW,
          ),
        ),
        y: Math.max(
          0,
          Math.min(
            0.9999,
            (e.clientY - containerRect.top - offsetY) / renderedH,
          ),
        ),
      };
    },
    [videoWidth, videoHeight],
  );

  const handlePointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
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
    [getNormCoords, onTouch],
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!isPointerDown.current || e.buttons === 0 || touchFailed.current)
        return;
      const now = performance.now();
      if (now - lastDragTime.current < DRAG_THROTTLE_MS) return;
      lastDragTime.current = now;
      const { x, y } = getNormCoords(e);
      try {
        onTouch(x, y, 1);
      } catch {
        touchFailed.current = true;
      }
    },
    [getNormCoords, onTouch],
  );

  const handlePointerUp = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      isPointerDown.current = false;
      e.currentTarget.releasePointerCapture(e.pointerId);
      document.body.classList.remove("sim-touching");
      const { x, y } = getNormCoords(e);
      onTouch(x, y, 2);
    },
    [getNormCoords, onTouch],
  );

  return (
    <div
      className={styles.streamBody}
      tabIndex={0}
      onKeyDown={onKeyDown}
      onKeyUp={onKeyUp}
    >
      <div
        className={styles.canvasContainer}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
      >
        <canvas
          ref={canvasRef}
          className={styles.canvas}
          width={videoWidth || undefined}
          height={videoHeight || undefined}
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
