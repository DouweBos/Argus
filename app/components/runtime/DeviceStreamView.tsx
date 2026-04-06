import { useCallback, useRef } from "react";
import { useSimulatorCapture } from "../../hooks/useSimulatorCapture";
import styles from "./SimulatorView.module.css";

const DRAG_THROTTLE_MS = 17;

interface StreamRenderProps {
  imgRef: React.RefObject<HTMLImageElement | null>;
  isReceiving: boolean;
  streamUrl: null | string;
}

export interface DeviceStreamViewProps {
  actionButtons: React.ReactNode;
  capturing: boolean;
  /** Platform toggle, rendered at the start of the title bar. */
  children?: React.ReactNode;
  devicePicker: React.ReactNode;
  mjpegPort: null | number;
  onKeyDown: (e: React.KeyboardEvent<HTMLDivElement>) => void;
  onKeyUp: (e: React.KeyboardEvent<HTMLDivElement>) => void;
  /** Called with normalized [0..1] coordinates and event type (0=down, 1=move, 2=up). */
  onTouch: (x: number, y: number, eventType: number) => void;
  placeholder: React.ReactNode;
  /** Override the default stream body (e.g. tvOS side-by-side remote layout). */
  renderStream?: (props: StreamRenderProps) => React.ReactNode;
  streamAlt?: string;
  toolsAvailable: boolean | null;
  toolsMissing: { body: React.ReactNode; title: string };
}

export function DeviceStreamView({
  children,
  capturing,
  mjpegPort,
  toolsAvailable,
  toolsMissing,
  devicePicker,
  actionButtons,
  placeholder,
  onTouch,
  onKeyDown,
  onKeyUp,
  renderStream,
  streamAlt = "Device",
}: DeviceStreamViewProps) {
  const { imgRef, streamUrl, isReceiving } = useSimulatorCapture(
    capturing ? mjpegPort : null,
  );

  // --- Touch normalization & pointer handlers ---

  const touchFailed = useRef(false);
  const lastDragTime = useRef(0);
  const isPointerDown = useRef(false);

  const getNormCoords = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const img = imgRef.current;
      if (!img) {
        const rect = e.currentTarget.getBoundingClientRect();
        return {
          x: (e.clientX - rect.left) / rect.width,
          y: (e.clientY - rect.top) / rect.height,
        };
      }

      const containerRect = e.currentTarget.getBoundingClientRect();
      const naturalW = img.naturalWidth;
      const naturalH = img.naturalHeight;
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
    [imgRef],
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

  // --- Render helpers ---

  const titleBar = (
    <div className={styles.titleBar}>
      {children}
      {devicePicker}
      {actionButtons}
    </div>
  );

  const canvas = (
    <>
      {streamUrl && (
        <img
          ref={imgRef}
          src={streamUrl}
          className={styles.canvas}
          draggable={false}
          alt={streamAlt}
        />
      )}
      {!isReceiving && (
        <div className={styles.connecting}>
          <p>Waiting for frames...</p>
        </div>
      )}
    </>
  );

  // --- Layout ---

  if (toolsAvailable === false) {
    return (
      <>
        <div className={styles.titleBar}>{children}</div>
        <div className={styles.placeholder}>
          <div className={styles.toolsMissingHint}>
            <p className={styles.toolsMissingTitle}>{toolsMissing.title}</p>
            {toolsMissing.body}
          </div>
        </div>
      </>
    );
  }

  if (!capturing) {
    return (
      <>
        {titleBar}
        <div className={styles.placeholder}>{placeholder}</div>
      </>
    );
  }

  if (renderStream) {
    return (
      <>
        {titleBar}
        {renderStream({ imgRef, streamUrl, isReceiving })}
      </>
    );
  }

  return (
    <>
      {titleBar}
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
          {canvas}
        </div>
      </div>
    </>
  );
}
