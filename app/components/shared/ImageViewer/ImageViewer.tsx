import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  closeImageViewer,
  useImageViewerAlt,
  useImageViewerFallbackSrc,
  useImageViewerSrc,
} from "../../../stores/imageViewerStore";
import styles from "./ImageViewer.module.css";
import { constrainPan, fitTransform, usePanZoom } from "./usePanZoom";

const IDENTITY = { scale: 1, tx: 0, ty: 0 };

/** Map a 0–1 slider position to a scale using logarithmic interpolation. */
function sliderToScale(v: number, min: number, max: number): number {
  return min * Math.pow(max / min, v);
}

/** Inverse: scale → 0–1 slider position. */
function scaleToSlider(s: number, min: number, max: number): number {
  if (max <= min) {return 0;}

  return Math.log(s / min) / Math.log(max / min);
}

export function ImageViewer() {
  const src = useImageViewerSrc();
  const alt = useImageViewerAlt();
  const fallbackSrc = useImageViewerFallbackSrc();

  if (!src) {return null;}

  return createPortal(
    <ImageViewerOverlay alt={alt} fallbackSrc={fallbackSrc} src={src} />,
    document.body,
  );
}

function ImageViewerOverlay({
  src,
  alt,
  fallbackSrc,
}: {
  alt: string;
  fallbackSrc: string | null;
  src: string;
}) {
  const imgRef = useRef<HTMLImageElement>(null);
  const canvasRef = useRef<HTMLDivElement>(null);
  const [imgSize, setImgSize] = useState<{ h: number; w: number; } | null>(
    null,
  );
  const [boxSize, setBoxSize] = useState({ w: 0, h: 0 });

  useEffect(() => {
    const el = canvasRef.current;
    if (!el) {return;}
    const ro = new ResizeObserver(([entry]) => {
      setBoxSize({
        w: entry.contentRect.width,
        h: entry.contentRect.height,
      });
    });
    ro.observe(el);

    return () => ro.disconnect();
  }, []);

  const fitScale =
    imgSize && boxSize.w > 0
      ? fitTransform(imgSize.w, imgSize.h, boxSize.w, boxSize.h).scale
      : 0.1;
  const minScale = fitScale;
  const maxScale = Math.max(3, fitScale * 10);

  const constrain = useCallback(
    (t: { scale: number; tx: number; ty: number }) => {
      if (!imgSize || boxSize.w === 0) {return t;}

      return constrainPan(t, imgSize.w, imgSize.h, boxSize.w, boxSize.h);
    },
    [imgSize, boxSize.w, boxSize.h],
  );

  const { transform, resetTo, wheelRef, handlers } = usePanZoom(IDENTITY, {
    minScale,
    maxScale,
    constrain,
  });

  const fitToScreen = useCallback(() => {
    if (!imgSize || boxSize.w === 0) {return;}
    resetTo(fitTransform(imgSize.w, imgSize.h, boxSize.w, boxSize.h));
  }, [imgSize, boxSize.w, boxSize.h, resetTo]);

  const onImageLoad = useCallback(() => {
    const img = imgRef.current;
    const el = canvasRef.current;
    if (!img || !el) {return;}
    setImgSize({ w: img.naturalWidth, h: img.naturalHeight });
    const { width, height } = el.getBoundingClientRect();
    resetTo(
      fitTransform(img.naturalWidth, img.naturalHeight, width, height),
    );
  }, [resetTo]);

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
      if (e.key === "Escape") {closeImageViewer();}
    };
    document.addEventListener("keydown", onKey);

    return () => document.removeEventListener("keydown", onKey);
  }, []);

  const onMinimapPan = useCallback(
    (newTx: number, newTy: number) => {
      resetTo({ scale: transform.scale, tx: newTx, ty: newTy });
    },
    [transform.scale, resetTo],
  );

  const canPan =
    imgSize != null &&
    (imgSize.w * transform.scale > boxSize.w ||
      imgSize.h * transform.scale > boxSize.h);

  const pct = Math.round(transform.scale * 100);
  const sliderValue = scaleToSlider(transform.scale, minScale, maxScale);

  return (
    <>
      <div className={styles.backdrop} onClick={closeImageViewer} />
      <div className={styles.dialog}>
        <button
          aria-label="Close"
          className={styles.closeBtn}
          onClick={closeImageViewer}
        >
          ✕
        </button>
        <div
          ref={(el) => {
            canvasRef.current = el;
            wheelRef.current = el;
          }}
          className={`${styles.canvas} ${canPan ? styles.canvasPannable : ""}`}
          {...handlers}
        >
          <img
            ref={imgRef}
            alt={alt}
            className={styles.image}
            draggable={false}
            onDoubleClick={fitToScreen}
            onError={(e) => {
              if (fallbackSrc && e.currentTarget.src !== fallbackSrc) {
                e.currentTarget.src = fallbackSrc;
              }
            }}
            onLoad={onImageLoad}
            src={src}
            style={{
              transform: `translate(${transform.tx}px, ${transform.ty}px)`,
              width: imgSize
                ? imgSize.w * transform.scale
                : undefined,
              height: imgSize
                ? imgSize.h * transform.scale
                : undefined,
            }}
          />
          {canPan && imgSize && (
            <Minimap
              boxH={boxSize.h}
              boxW={boxSize.w}
              imgH={imgSize.h}
              imgW={imgSize.w}
              onPan={onMinimapPan}
              scale={transform.scale}
              src={src}
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
  src,
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
  src: string;
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
      if (!anchor) {return;}
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
      if (!rect) {return;}
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
      if (!dragAnchorRef.current) {return;}
      const rect = minimapRef.current?.getBoundingClientRect();
      if (!rect) {return;}
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
      <img alt="" className={styles.minimapImage} src={src} />
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
