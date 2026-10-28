import {
  type PointerEvent as ReactPointerEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { EnlargeIcon, MinusIcon, PlusIcon } from "../../icons/Icons";
import styles from "./ZoomPanImage.module.css";

export interface ZoomPanImageProps {
  alt: string;
  className?: string;
  /** Logical size the image shows at 100% (e.g. a 2x render's size in points). Defaults to its pixel size. */
  height?: number;
  src: string;
  width?: number;
}

interface View {
  scale: number;
  x: number;
  y: number;
}

const MIN_SCALE = 0.05;
const MAX_SCALE = 8;
const STEP = 1.25;

function clampScale(scale: number): number {
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale));
}

/** Centre a `w×h` image in a `cw×ch` box, shrunk to fit but never enlarged past 100%. */
export function fitView(cw: number, ch: number, w: number, h: number): View {
  if (w <= 0 || h <= 0 || cw <= 0 || ch <= 0) {
    return { scale: 1, x: 0, y: 0 };
  }
  const scale = Math.min(1, cw / w, ch / h);

  return { scale, x: (cw - w * scale) / 2, y: (ch - h * scale) / 2 };
}

/** Zoom to `next` keeping the point under (ax, ay) still. */
export function zoomAround(view: View, next: number, ax: number, ay: number) {
  const scale = clampScale(next);
  const k = scale / view.scale;

  return { scale, x: ax - (ax - view.x) * k, y: ay - (ay - view.y) * k };
}

/**
 * An image you can fit, zoom (buttons, pinch or ⌘-scroll) and pan (drag or
 * scroll). Starts fitted; Fit snaps back.
 */
export function ZoomPanImage({
  alt,
  className,
  height,
  src,
  width,
}: ZoomPanImageProps) {
  const boxRef = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState({ w: 0, h: 0 });
  const [natural, setNatural] = useState({ w: 0, h: 0 });
  const [view, setView] = useState<View | null>(null);
  const drag = useRef<{ x: number; y: number } | null>(null);
  const w = width ?? natural.w;
  const h = height ?? natural.h;
  const current = view ?? fitView(box.w, box.h, w, h);

  useEffect(() => {
    const el = boxRef.current;
    if (!el) {
      return;
    }
    const observer = new ResizeObserver(([entry]) =>
      setBox({ w: entry.contentRect.width, h: entry.contentRect.height }),
    );
    observer.observe(el);

    return () => observer.disconnect();
  }, []);

  // A new image starts fitted again.
  useEffect(() => setView(null), [src]);

  useEffect(() => {
    const el = boxRef.current;
    if (!el) {
      return;
    }
    // Non-passive so scrolling pans the image instead of the page.
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      setView((prev) => {
        const base = prev ?? fitView(rect.width, rect.height, w, h);
        if (e.ctrlKey || e.metaKey) {
          return zoomAround(
            base,
            base.scale * Math.exp(-e.deltaY / 200),
            e.clientX - rect.left,
            e.clientY - rect.top,
          );
        }

        return { ...base, x: base.x - e.deltaX, y: base.y - e.deltaY };
      });
    };
    el.addEventListener("wheel", onWheel, { passive: false });

    return () => el.removeEventListener("wheel", onWheel);
  }, [w, h]);

  const zoomBy = useCallback(
    (factor: number) =>
      setView((prev) => {
        const base = prev ?? fitView(box.w, box.h, w, h);

        return zoomAround(base, base.scale * factor, box.w / 2, box.h / 2);
      }),
    [box, w, h],
  );

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { x: e.clientX, y: e.clientY };
  };
  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const start = drag.current;
    if (!start) {
      return;
    }
    const dx = e.clientX - start.x;
    const dy = e.clientY - start.y;
    drag.current = { x: e.clientX, y: e.clientY };
    setView((prev) => {
      const base = prev ?? fitView(box.w, box.h, w, h);

      return { ...base, x: base.x + dx, y: base.y + dy };
    });
  };
  const endDrag = () => {
    drag.current = null;
  };

  return (
    <div className={[styles.root, className].filter(Boolean).join(" ")}>
      <div
        ref={boxRef}
        className={styles.viewport}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onDoubleClick={() => setView(null)}
      >
        <img
          alt={alt}
          className={styles.image}
          draggable={false}
          src={src}
          onLoad={(e) =>
            setNatural({
              w: e.currentTarget.naturalWidth,
              h: e.currentTarget.naturalHeight,
            })
          }
          style={{
            width: w || undefined,
            height: h || undefined,
            transform: `translate(${current.x}px, ${current.y}px) scale(${current.scale})`,
          }}
        />
      </div>
      <div className={styles.controls}>
        <button
          type="button"
          className={styles.control}
          aria-label="Zoom out"
          onClick={() => zoomBy(1 / STEP)}
        >
          <MinusIcon size={12} />
        </button>
        <button
          type="button"
          className={styles.percent}
          title="Actual size"
          onClick={() => setView(zoomAround(current, 1, box.w / 2, box.h / 2))}
        >
          {Math.round(current.scale * 100)}%
        </button>
        <button
          type="button"
          className={styles.control}
          aria-label="Zoom in"
          onClick={() => zoomBy(STEP)}
        >
          <PlusIcon size={12} />
        </button>
        <button
          type="button"
          className={styles.control}
          aria-label="Fit"
          aria-pressed={view === null}
          title="Fit"
          onClick={() => setView(null)}
        >
          <EnlargeIcon size={12} />
        </button>
      </div>
    </div>
  );
}
