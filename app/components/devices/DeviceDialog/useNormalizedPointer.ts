import type { RefObject } from "react";
import { useCallback, useRef } from "react";

const DRAG_THROTTLE_MS = 17;

interface MediaSize {
  height: number;
  width: number;
}

interface UseNormalizedPointerOpts {
  /**
   * How to read the intrinsic dimensions of the media being rendered inside
   * the container — `naturalWidth/Height` for <img>, `width/height` for
   * <canvas>. Returning null falls back to container dimensions.
   */
  getMediaSize: () => MediaSize | null;
  /**
   * Called with normalised [0..1] coords and an event type:
   * 0 = down, 1 = move, 2 = up.
   */
  onTouch: (x: number, y: number, type: 0 | 1 | 2) => void;
}

interface UseNormalizedPointerResult {
  /** Spread onto the interactive container. */
  handlers: {
    onPointerCancel: (e: React.PointerEvent<HTMLDivElement>) => void;
    onPointerDown: (e: React.PointerEvent<HTMLDivElement>) => void;
    onPointerMove: (e: React.PointerEvent<HTMLDivElement>) => void;
    onPointerUp: (e: React.PointerEvent<HTMLDivElement>) => void;
  };
}

/**
 * Shared pointer handler set for simulator-style previews. Normalises the
 * pointer position against the rendered media rectangle (object-fit: contain),
 * throttles move events, and captures the pointer for the duration of a drag.
 */
export function useNormalizedPointer(
  _containerRef: RefObject<HTMLDivElement | null>,
  { getMediaSize, onTouch }: UseNormalizedPointerOpts,
): UseNormalizedPointerResult {
  const downRef = useRef(false);
  const failedRef = useRef(false);
  const lastDragTime = useRef(0);

  const getCoords = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const rect = e.currentTarget.getBoundingClientRect();
      const size = getMediaSize();
      if (!size || size.width === 0 || size.height === 0) {
        return {
          x: clamp((e.clientX - rect.left) / rect.width),
          y: clamp((e.clientY - rect.top) / rect.height),
        };
      }
      const scale = Math.min(
        rect.width / size.width,
        rect.height / size.height,
      );
      const renderedW = size.width * scale;
      const renderedH = size.height * scale;
      const offsetX = (rect.width - renderedW) / 2;
      const offsetY = (rect.height - renderedH) / 2;

      return {
        x: clamp((e.clientX - rect.left - offsetX) / renderedW),
        y: clamp((e.clientY - rect.top - offsetY) / renderedH),
      };
    },
    [getMediaSize],
  );

  const onPointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      failedRef.current = false;
      downRef.current = true;
      e.currentTarget.setPointerCapture(e.pointerId);
      const { x, y } = getCoords(e);
      try {
        onTouch(x, y, 0);
      } catch {
        failedRef.current = true;
      }
    },
    [getCoords, onTouch],
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!downRef.current || e.buttons === 0 || failedRef.current) {
        return;
      }
      const now = performance.now();
      if (now - lastDragTime.current < DRAG_THROTTLE_MS) {
        return;
      }
      lastDragTime.current = now;
      const { x, y } = getCoords(e);
      try {
        onTouch(x, y, 1);
      } catch {
        failedRef.current = true;
      }
    },
    [getCoords, onTouch],
  );

  const onPointerUp = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!downRef.current) {
        return;
      }
      downRef.current = false;
      try {
        e.currentTarget.releasePointerCapture(e.pointerId);
      } catch {
        // ignore — pointer may have already been released
      }
      const { x, y } = getCoords(e);
      onTouch(x, y, 2);
    },
    [getCoords, onTouch],
  );

  return {
    handlers: {
      onPointerDown,
      onPointerMove,
      onPointerUp,
      onPointerCancel: onPointerUp,
    },
  };
}

function clamp(v: number): number {
  if (v < 0) {
    return 0;
  }
  if (v > 0.9999) {
    return 0.9999;
  }

  return v;
}
