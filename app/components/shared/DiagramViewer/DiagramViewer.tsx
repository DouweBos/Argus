import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { invalidateMermaidTheme, renderMermaid } from "../../../lib/mermaid";
import {
  closeDiagramViewer,
  useDiagramViewerCode,
} from "../../../stores/diagramViewerStore";
import { useResolvedTheme } from "../../../stores/themeStore";
import { CloseIcon } from "../Icons";
import {
  constrainPan,
  fitTransform,
  usePanZoom,
} from "../ImageViewer/usePanZoom";
import styles from "./DiagramViewer.module.css";

const IDENTITY = { scale: 1, tx: 0, ty: 0 };

function sliderToScale(v: number, min: number, max: number): number {
  return min * Math.pow(max / min, v);
}

function scaleToSlider(s: number, min: number, max: number): number {
  if (max <= min) {
    return 0;
  }

  return Math.log(s / min) / Math.log(max / min);
}

/** Extract intrinsic width/height from a mermaid SVG's viewBox. */
function svgSize(svg: string): { h: number; w: number } | null {
  const match = svg.match(/viewBox="([\d.eE\s+-]+)"/);
  if (!match) {
    return null;
  }
  const parts = match[1].trim().split(/\s+/).map(Number);
  if (parts.length !== 4 || !(parts[2] > 0) || !(parts[3] > 0)) {
    return null;
  }

  return { w: parts[2], h: parts[3] };
}

export function DiagramViewer() {
  const code = useDiagramViewerCode();
  if (!code) {
    return null;
  }

  return createPortal(<DiagramOverlay code={code} />, document.body);
}

function DiagramOverlay({ code }: { code: string }) {
  const theme = useResolvedTheme();
  const canvasRef = useRef<HTMLDivElement>(null);
  const [svg, setSvg] = useState<string | null>(null);
  const [size, setSize] = useState<{ h: number; w: number } | null>(null);
  const [boxSize, setBoxSize] = useState({ w: 0, h: 0 });

  useEffect(() => {
    let alive = true;
    invalidateMermaidTheme();
    renderMermaid("diagram-viewer", code)
      .then((out) => {
        if (alive) {
          setSvg(out);
          setSize(svgSize(out));
        }
      })
      .catch(() => {
        if (alive) {
          setSvg(null);
        }
      });

    return () => {
      alive = false;
    };
  }, [code, theme]);

  useEffect(() => {
    const el = canvasRef.current;
    if (!el) {
      return;
    }
    const ro = new ResizeObserver(([entry]) => {
      setBoxSize({ w: entry.contentRect.width, h: entry.contentRect.height });
    });
    ro.observe(el);

    return () => ro.disconnect();
  }, []);

  const fitScale =
    size && boxSize.w > 0
      ? fitTransform(size.w, size.h, boxSize.w, boxSize.h).scale
      : 0.1;
  const minScale = Math.min(fitScale, 1);
  const maxScale = Math.max(4, fitScale * 12);

  const constrain = useCallback(
    (t: { scale: number; tx: number; ty: number }) => {
      if (!size || boxSize.w === 0) {
        return t;
      }

      return constrainPan(t, size.w, size.h, boxSize.w, boxSize.h);
    },
    [size, boxSize.w, boxSize.h],
  );

  const { transform, resetTo, wheelRef, handlers } = usePanZoom(IDENTITY, {
    minScale,
    maxScale,
    constrain,
  });

  // Fit once the diagram and container are both measured.
  useEffect(() => {
    if (!size || boxSize.w === 0) {
      return;
    }
    resetTo(fitTransform(size.w, size.h, boxSize.w, boxSize.h));
  }, [size, boxSize.w, boxSize.h, resetTo]);

  const fitToScreen = useCallback(() => {
    if (!size || boxSize.w === 0) {
      return;
    }
    resetTo(fitTransform(size.w, size.h, boxSize.w, boxSize.h));
  }, [size, boxSize.w, boxSize.h, resetTo]);

  const onSliderChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const newScale = sliderToScale(
        parseFloat(e.target.value),
        minScale,
        maxScale,
      );
      const cx = boxSize.w / 2;
      const cy = boxSize.h / 2;
      resetTo({
        scale: newScale,
        tx: cx - (newScale / transform.scale) * (cx - transform.tx),
        ty: cy - (newScale / transform.scale) * (cy - transform.ty),
      });
    },
    [minScale, maxScale, boxSize.w, boxSize.h, transform, resetTo],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") {
        return;
      }
      e.stopPropagation();
      closeDiagramViewer();
    };
    document.addEventListener("keydown", onKey, true);

    return () => document.removeEventListener("keydown", onKey, true);
  }, []);

  const onMinimapPan = useCallback(
    (newTx: number, newTy: number) => {
      resetTo({ scale: transform.scale, tx: newTx, ty: newTy });
    },
    [transform.scale, resetTo],
  );

  const canPan =
    size != null &&
    (size.w * transform.scale > boxSize.w ||
      size.h * transform.scale > boxSize.h);

  const pct = Math.round(transform.scale * 100);
  const sliderValue = scaleToSlider(transform.scale, minScale, maxScale);
  const stageStyle = useMemo(
    () => ({
      transform: `translate(${transform.tx}px, ${transform.ty}px)`,
      width: size ? size.w * transform.scale : undefined,
      height: size ? size.h * transform.scale : undefined,
    }),
    [transform, size],
  );

  return (
    <>
      <div className={styles.backdrop} onClick={closeDiagramViewer} />
      <div className={styles.dialog}>
        <button
          aria-label="Close"
          className={styles.closeBtn}
          onClick={closeDiagramViewer}
          type="button"
        >
          <CloseIcon size={12} />
        </button>
        <div
          ref={(el) => {
            canvasRef.current = el;
            wheelRef.current = el;
          }}
          className={`${styles.canvas} ${canPan ? styles.canvasPannable : ""}`}
          {...handlers}
        >
          {svg && (
            <div
              className={styles.stage}
              dangerouslySetInnerHTML={{ __html: svg }}
              onDoubleClick={fitToScreen}
              style={stageStyle}
            />
          )}
          {canPan && svg && size && (
            <Minimap
              boxH={boxSize.h}
              boxW={boxSize.w}
              imgH={size.h}
              imgW={size.w}
              onPan={onMinimapPan}
              scale={transform.scale}
              svg={svg}
              tx={transform.tx}
              ty={transform.ty}
            />
          )}
          <div className={styles.toolbar}>
            <span className={styles.zoomLabel}>{pct}%</span>
            <input
              className={styles.slider}
              max="1"
              min="0"
              onChange={onSliderChange}
              step="0.005"
              type="range"
              value={sliderValue}
            />
          </div>
        </div>
      </div>
    </>
  );
}

const MINI_W = 140;

function Minimap({
  svg,
  imgW,
  imgH,
  boxW,
  boxH,
  tx,
  ty,
  scale,
  onPan,
}: {
  boxH: number;
  boxW: number;
  imgH: number;
  imgW: number;
  onPan: (tx: number, ty: number) => void;
  scale: number;
  svg: string;
  tx: number;
  ty: number;
}) {
  const miniH = MINI_W * (imgH / imgW);
  const m = MINI_W / imgW;

  const vpLeft = Math.max(0, (-tx / scale) * m);
  const vpTop = Math.max(0, (-ty / scale) * m);
  const vpWidth = Math.min(MINI_W - vpLeft, (boxW / scale) * m);
  const vpHeight = Math.min(miniH - vpTop, (boxH / scale) * m);

  const minimapRef = useRef<HTMLDivElement>(null);
  const dragAnchorRef = useRef<{ offX: number; offY: number } | null>(null);

  const panToMiniCoords = useCallback(
    (mx: number, my: number) => {
      const anchor = dragAnchorRef.current;
      if (!anchor) {
        return;
      }
      const newVpLeft = mx - anchor.offX;
      const newVpTop = my - anchor.offY;
      onPan(-(newVpLeft / m) * scale, -(newVpTop / m) * scale);
    },
    [m, scale, onPan],
  );

  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      e.stopPropagation();
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      const rect = minimapRef.current?.getBoundingClientRect();
      if (!rect) {
        return;
      }
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;

      const insideVp =
        mx >= vpLeft &&
        mx <= vpLeft + vpWidth &&
        my >= vpTop &&
        my <= vpTop + vpHeight;

      if (insideVp) {
        dragAnchorRef.current = { offX: mx - vpLeft, offY: my - vpTop };
      } else {
        dragAnchorRef.current = { offX: vpWidth / 2, offY: vpHeight / 2 };
        onPan(
          -((mx - vpWidth / 2) / m) * scale,
          -((my - vpHeight / 2) / m) * scale,
        );
      }
    },
    [vpLeft, vpTop, vpWidth, vpHeight, m, scale, onPan],
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (!dragAnchorRef.current) {
        return;
      }
      const rect = minimapRef.current?.getBoundingClientRect();
      if (!rect) {
        return;
      }
      panToMiniCoords(e.clientX - rect.left, e.clientY - rect.top);
    },
    [panToMiniCoords],
  );

  const onPointerUp = useCallback(() => {
    dragAnchorRef.current = null;
  }, []);

  return (
    <div
      ref={minimapRef}
      className={styles.minimap}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      style={{ width: MINI_W, height: miniH }}
    >
      <div
        className={styles.minimapImage}
        dangerouslySetInnerHTML={{ __html: svg }}
      />
      <div
        className={styles.minimapViewport}
        style={{
          left: vpLeft,
          top: vpTop,
          width: vpWidth,
          height: vpHeight,
        }}
      />
    </div>
  );
}
