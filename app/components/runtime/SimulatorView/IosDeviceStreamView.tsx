import { useCallback, useRef } from "react";
import { useSimulatorCapture } from "../../../hooks/useSimulatorCapture";
import chrome from "../RuntimeChrome.module.css";
import { RuntimeTitleBar } from "../RuntimeTitleBar";
import styles from "./RuntimeView.module.css";

const DRAG_THROTTLE_MS = 17;

interface StreamRenderProps {
  imgRef: React.RefObject<HTMLImageElement | null>;
  isReceiving: boolean;
  streamUrl: string | null;
}

export interface IosDeviceStreamViewProps {
  /** Hardware / session controls rendered in the floating bar below the title row. */
  actionButtons: React.ReactNode;
  capturing: boolean;
  /** Platform toggle, rendered at the start of the title bar. */
  children?: React.ReactNode;
  devicePicker: React.ReactNode;
  mjpegPort: number | null;
  onKeyDown: (e: React.KeyboardEvent<HTMLDivElement>) => void;
  onKeyUp: (e: React.KeyboardEvent<HTMLDivElement>) => void;
  /** Called with normalized [0..1] coordinates and event type (0=down, 1=move, 2=up). */
  onTouch: (x: number, y: number, eventType: number) => void;
  placeholder: React.ReactNode;
  /** Override the default stream body (e.g. tvOS side-by-side remote layout). */
  renderStream?: (props: StreamRenderProps) => React.ReactNode;
  /**
   * When false, the floating bar is hidden. When true but the device session is
   * idle, the bar can still show workspace actions such as Run (see simulator
   * views). Use `titleBarExtra` for boot controls on the title row when idle.
   */
  showFloatingActionBar?: boolean;
  streamAlt?: string;
  /** Trailing controls on the title row (e.g. boot when idle). */
  titleBarExtra?: React.ReactNode;
  toolsAvailable: boolean | null;
  toolsMissing: { body: React.ReactNode; title: string };
}

export function IosDeviceStreamView({
  actionButtons,
  capturing,
  children,
  devicePicker,
  mjpegPort,
  placeholder,
  showFloatingActionBar = true,
  titleBarExtra,
  toolsAvailable,
  toolsMissing,
  renderStream,
  streamAlt = "Device",
  onKeyDown,
  onKeyUp,
  onTouch,
}: IosDeviceStreamViewProps) {
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
      if (!isPointerDown.current || e.buttons === 0 || touchFailed.current) {
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

  const titleChrome = (
    <RuntimeTitleBar
      actionBar={actionButtons}
      picker={devicePicker}
      showActionBar={showFloatingActionBar}
      spacedActionBar
      trailing={titleBarExtra}
    >
      {children}
    </RuntimeTitleBar>
  );

  const canvas = (
    <>
      {streamUrl && (
        <img
          ref={imgRef}
          alt={streamAlt}
          className={styles.canvas}
          draggable={false}
          src={streamUrl}
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
        <RuntimeTitleBar>{children}</RuntimeTitleBar>
        <div className={chrome.placeholder}>
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
        {titleChrome}
        <div className={chrome.placeholder}>{placeholder}</div>
      </>
    );
  }

  if (renderStream) {
    return (
      <>
        {titleChrome}
        {renderStream({ imgRef, streamUrl, isReceiving })}
      </>
    );
  }

  return (
    <>
      {titleChrome}
      <div
        className={styles.streamBody}
        tabIndex={0}
        onKeyDown={onKeyDown}
        onKeyUp={onKeyUp}
      >
        <div
          className={styles.canvasContainer}
          onPointerCancel={handlePointerUp}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
        >
          {canvas}
        </div>
      </div>
    </>
  );
}
