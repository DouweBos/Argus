import { useCallback, useEffect, useRef, useState } from "react";

export interface Transform {
  scale: number;
  tx: number;
  ty: number;
}

interface Pointer {
  id: number;
  x: number;
  y: number;
}

const WHEEL_FACTOR = 1.04;

function dist(a: Pointer, b: Pointer): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function mid(a: Pointer, b: Pointer): { x: number; y: number } {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

/**
 * Compute the transform that fits an image (naturalW x naturalH) centered
 * inside a viewport (vpW x vpH) with padding on each side.
 */
export function fitTransform(
  naturalW: number,
  naturalH: number,
  vpW: number,
  vpH: number,
  padding = 48,
): Transform {
  const maxW = vpW - padding * 2;
  const maxH = vpH - padding * 2;
  const scale = Math.min(1, maxW / naturalW, maxH / naturalH);

  return {
    scale,
    tx: (vpW - naturalW * scale) / 2,
    ty: (vpH - naturalH * scale) / 2,
  };
}

/**
 * Center the image when it's smaller than the container on a given axis;
 * clamp so edges don't go past container bounds when it's larger.
 */
export function constrainPan(
  t: Transform,
  imageW: number,
  imageH: number,
  containerW: number,
  containerH: number,
): Transform {
  const dW = imageW * t.scale;
  const dH = imageH * t.scale;

  return {
    scale: t.scale,
    tx:
      dW <= containerW
        ? (containerW - dW) / 2
        : Math.min(0, Math.max(containerW - dW, t.tx)),
    ty:
      dH <= containerH
        ? (containerH - dH) / 2
        : Math.min(0, Math.max(containerH - dH, t.ty)),
  };
}

export interface PanZoomOptions {
  /** Post-process every transform update (e.g. clamp panning bounds). */
  constrain?: (t: Transform) => Transform;
  maxScale?: number;
  minScale?: number;
}

export function usePanZoom(
  initialTransform: Transform,
  options?: PanZoomOptions,
) {
  const optsRef = useRef(options);
  useEffect(() => {
    optsRef.current = options;
  });

  const clampScale = useCallback((s: number): number => {
    const o = optsRef.current;

    return Math.min(o?.maxScale ?? 20, Math.max(o?.minScale ?? 0.1, s));
  }, []);

  const commit = useCallback(
    (t: Transform): Transform => {
      const clamped: Transform = { ...t, scale: clampScale(t.scale) };

      return optsRef.current?.constrain?.(clamped) ?? clamped;
    },
    [clampScale],
  );

  const [transform, setTransform] = useState<Transform>(initialTransform);
  const tRef = useRef(transform);
  useEffect(() => {
    tRef.current = transform;
  });

  const pointersRef = useRef<Pointer[]>([]);
  const pinchDistRef = useRef<number | null>(null);
  const pinchMidRef = useRef<{ x: number; y: number } | null>(null);
  const dragRef = useRef<{
    tx: number;
    ty: number;
    x: number;
    y: number;
  } | null>(null);

  const resetTo = useCallback(
    (t: Transform) => setTransform(commit(t)),
    [commit],
  );

  // Wheel zoom must be attached natively with { passive: false } so
  // preventDefault() works. React registers wheel listeners as passive.
  const elRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const el = elRef.current;
    if (!el) {
      return;
    }

    const handleWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      const cx = e.clientX - rect.left;
      const cy = e.clientY - rect.top;

      setTransform((prev) => {
        const ns = clampScale(
          prev.scale * (e.deltaY < 0 ? WHEEL_FACTOR : 1 / WHEEL_FACTOR),
        );
        const r = ns / prev.scale;

        return commit({
          scale: ns,
          tx: cx - r * (cx - prev.tx),
          ty: cy - r * (cy - prev.ty),
        });
      });
    };

    el.addEventListener("wheel", handleWheel, { passive: false });

    return () => el.removeEventListener("wheel", handleWheel);
  }, [clampScale, commit]);

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    pointersRef.current = [
      ...pointersRef.current,
      { id: e.pointerId, x: e.clientX, y: e.clientY },
    ];

    if (pointersRef.current.length === 1) {
      const t = tRef.current;
      dragRef.current = { x: e.clientX, y: e.clientY, tx: t.tx, ty: t.ty };
    } else if (pointersRef.current.length === 2) {
      const [a, b] = pointersRef.current;
      pinchDistRef.current = dist(a, b);
      pinchMidRef.current = mid(a, b);
      dragRef.current = null;
    }
  }, []);

  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      const ptrs = pointersRef.current;
      const idx = ptrs.findIndex((p) => p.id === e.pointerId);
      if (idx === -1) {
        return;
      }
      ptrs[idx] = { id: e.pointerId, x: e.clientX, y: e.clientY };

      if (ptrs.length === 1 && dragRef.current) {
        const d = dragRef.current;
        setTransform((prev) =>
          commit({
            ...prev,
            tx: d.tx + (e.clientX - d.x),
            ty: d.ty + (e.clientY - d.y),
          }),
        );
      } else if (
        ptrs.length === 2 &&
        pinchDistRef.current != null &&
        pinchMidRef.current
      ) {
        const [a, b] = ptrs;
        const nd = dist(a, b);
        const nm = mid(a, b);
        const factor = nd / pinchDistRef.current;
        const pm = pinchMidRef.current;

        setTransform((prev) => {
          const ns = clampScale(prev.scale * factor);
          const r = ns / prev.scale;

          return commit({
            scale: ns,
            tx: nm.x - r * (pm.x - prev.tx) + (nm.x - pm.x),
            ty: nm.y - r * (pm.y - prev.ty) + (nm.y - pm.y),
          });
        });

        pinchDistRef.current = nd;
        pinchMidRef.current = nm;
      }
    },
    [clampScale, commit],
  );

  const onPointerUp = useCallback((e: React.PointerEvent) => {
    pointersRef.current = pointersRef.current.filter(
      (p) => p.id !== e.pointerId,
    );
    if (pointersRef.current.length < 2) {
      pinchDistRef.current = null;
      pinchMidRef.current = null;
    }
    if (pointersRef.current.length === 0) {
      dragRef.current = null;
    }
  }, []);

  return {
    transform,
    resetTo,
    /** Attach to the pan/zoom container element for native wheel handling. */
    wheelRef: elRef,
    handlers: { onPointerDown, onPointerMove, onPointerUp },
  };
}
