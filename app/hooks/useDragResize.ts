import { useState, useRef, useCallback, useEffect } from "react";

interface UseDragResizeOptions {
  axis: "horizontal" | "vertical";
  /** Initial size value (px or fraction) */
  initialSize: number;
  /** If true, dragging in the positive mouse direction shrinks */
  invert?: boolean;
  /**
   * Convert mouse delta (px) to size delta.
   * For fractions: (delta) => delta / containerWidth
   * For pixels: (delta) => delta
   */
  mapDelta?: (deltaPx: number) => number;
  max: (() => number) | number;
  min: number;
}

interface UseDragResizeResult {
  isDragging: boolean;
  onMouseDown: (e: React.MouseEvent) => void;
  setSize: (size: number) => void;
  size: number;
}

export function useDragResize({
  axis,
  initialSize,
  min,
  max,
  mapDelta = (d) => d,
  invert = false,
}: UseDragResizeOptions): UseDragResizeResult {
  const [size, setSize] = useState(initialSize);
  const dragging = useRef(false);
  const startPos = useRef(0);
  const startSize = useRef(0);

  const cursor = axis === "vertical" ? "row-resize" : "col-resize";

  const onMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      dragging.current = true;
      startPos.current = axis === "vertical" ? e.clientY : e.clientX;
      startSize.current = size;
      document.body.style.cursor = cursor;
      document.body.style.userSelect = "none";
    },
    [size, axis, cursor],
  );

  useEffect(() => {
    const onMouseMove = (e: MouseEvent) => {
      if (!dragging.current) return;

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

    const onMouseUp = () => {
      if (!dragging.current) return;
      dragging.current = false;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };

    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
    return () => {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    };
  }, [axis, min, max, mapDelta, invert]);

  return { size, setSize, onMouseDown, isDragging: dragging.current };
}
