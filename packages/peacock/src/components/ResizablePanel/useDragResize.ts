import { useCallback, useEffect, useRef, useState } from "react";

interface UseDragResizeOptions {
  axis: "horizontal" | "vertical";
  /** Initial size value (px or fraction) */
  initialSize: number;
  /** If true, dragging in the positive pointer direction shrinks */
  invert?: boolean;
  /**
   * Convert pointer delta (px) to size delta.
   * For fractions: (delta) => delta / containerWidth
   * For pixels: (delta) => delta
   */
  mapDelta?: (deltaPx: number) => number;
  max: number | (() => number);
  min: number;
}

interface UseDragResizeResult {
  isDragging: boolean;
  onPointerDown: (e: React.PointerEvent) => void;
  setSize: (size: number) => void;
  size: number;
}

/**
 * Pointer events (not mouse) so the divider drags with a finger or pencil on
 * touch devices as well as a mouse.
 */
export function useDragResize({
  axis,
  initialSize,
  min,
  max,
  mapDelta = (d) => d,
  invert = false,
}: UseDragResizeOptions): UseDragResizeResult {
  const [size, setSize] = useState(initialSize);
  const pointerId = useRef<number | null>(null);
  const startPos = useRef(0);
  const startSize = useRef(0);

  const cursor = axis === "vertical" ? "row-resize" : "col-resize";

  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      e.preventDefault();
      pointerId.current = e.pointerId;
      startPos.current = axis === "vertical" ? e.clientY : e.clientX;
      startSize.current = size;
      document.body.style.cursor = cursor;
      document.body.style.userSelect = "none";
    },
    [size, axis, cursor],
  );

  useEffect(() => {
    const onPointerMove = (e: PointerEvent) => {
      if (pointerId.current !== e.pointerId) {
        return;
      }

      const pos = axis === "vertical" ? e.clientY : e.clientX;
      const rawDelta = pos - startPos.current;
      const delta = mapDelta(invert ? -rawDelta : rawDelta);
      const maxVal = typeof max === "function" ? max() : max;
      const newSize = Math.min(
        maxVal,
        Math.max(min, startSize.current + delta),
      );
      setSize(newSize);
    };

    const onPointerUp = (e: PointerEvent) => {
      if (pointerId.current !== e.pointerId) {
        return;
      }
      pointerId.current = null;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };

    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
    window.addEventListener("pointercancel", onPointerUp);

    return () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
      window.removeEventListener("pointercancel", onPointerUp);
    };
  }, [axis, min, max, mapDelta, invert]);

  return {
    size,
    setSize,
    onPointerDown,
    isDragging: pointerId.current !== null,
  };
}
