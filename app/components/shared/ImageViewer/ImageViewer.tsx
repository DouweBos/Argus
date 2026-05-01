import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Icons } from "@argus/peacock";
import { showImageContextMenu } from "../../../lib/ipc";
import {
  closeImageViewer,
  type ImageCropResult,
  useImageViewerAlt,
  useImageViewerFallbackSrc,
  useImageViewerOnCrop,
  useImageViewerSrc,
} from "../../../stores/imageViewerStore";
import { CloseIcon } from "../Icons";
import styles from "./ImageViewer.module.css";
import { constrainPan, fitTransform, usePanZoom } from "./usePanZoom";

const IDENTITY = { scale: 1, tx: 0, ty: 0 };

/** Map a 0–1 slider position to a scale using logarithmic interpolation. */
function sliderToScale(v: number, min: number, max: number): number {
  return min * Math.pow(max / min, v);
}

/** Inverse: scale → 0–1 slider position. */
function scaleToSlider(s: number, min: number, max: number): number {
  if (max <= min) {
    return 0;
  }

  return Math.log(s / min) / Math.log(max / min);
}

export function ImageViewer() {
  const src = useImageViewerSrc();
  const alt = useImageViewerAlt();
  const fallbackSrc = useImageViewerFallbackSrc();
  const onCrop = useImageViewerOnCrop();

  if (!src) {
    return null;
  }

  return createPortal(
    <ImageViewerOverlay
      alt={alt}
      fallbackSrc={fallbackSrc}
      onCrop={onCrop}
      src={src}
    />,
    document.body,
  );
}

interface BoxRect {
  h: number;
  w: number;
  x: number;
  y: number;
}

type ResizeHandle = "e" | "n" | "ne" | "nw" | "s" | "se" | "sw" | "w";

function ImageViewerOverlay({
  src,
  alt,
  fallbackSrc,
  onCrop,
}: {
  alt: string;
  fallbackSrc: string | null;
  onCrop: ((result: ImageCropResult) => void) | null;
  src: string;
}) {
  const imgRef = useRef<HTMLImageElement>(null);
  const canvasRef = useRef<HTMLDivElement>(null);
  const [imgSize, setImgSize] = useState<{ h: number; w: number } | null>(null);
  const [boxSize, setBoxSize] = useState({ w: 0, h: 0 });
  const [cropping, setCropping] = useState(false);
  const [cropRect, setCropRect] = useState<BoxRect | null>(null);

  useEffect(() => {
    const el = canvasRef.current;
    if (!el) {
      return;
    }
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
      if (!imgSize || boxSize.w === 0) {
        return t;
      }

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
    if (!imgSize || boxSize.w === 0) {
      return;
    }
    resetTo(fitTransform(imgSize.w, imgSize.h, boxSize.w, boxSize.h));
  }, [imgSize, boxSize.w, boxSize.h, resetTo]);

  const onImageLoad = useCallback(() => {
    const img = imgRef.current;
    const el = canvasRef.current;
    if (!img || !el) {
      return;
    }
    setImgSize({ w: img.naturalWidth, h: img.naturalHeight });
    const { width, height } = el.getBoundingClientRect();
    resetTo(fitTransform(img.naturalWidth, img.naturalHeight, width, height));
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
      if (e.key !== "Escape") {
        return;
      }
      e.stopPropagation();
      if (cropping) {
        setCropping(false);
        setCropRect(null);

        return;
      }
      closeImageViewer();
    };
    document.addEventListener("keydown", onKey, true);

    return () => document.removeEventListener("keydown", onKey, true);
  }, [cropping]);

  // Image bounds in canvas (box) coordinates.
  const imageBoxRect = useMemo<BoxRect | null>(() => {
    if (!imgSize) {
      return null;
    }

    return {
      x: transform.tx,
      y: transform.ty,
      w: imgSize.w * transform.scale,
      h: imgSize.h * transform.scale,
    };
  }, [imgSize, transform]);

  const enterCropMode = useCallback(() => {
    if (!imageBoxRect) {
      return;
    }
    setCropRect({ ...imageBoxRect });
    setCropping(true);
  }, [imageBoxRect]);

  const cancelCrop = useCallback(() => {
    setCropping(false);
    setCropRect(null);
  }, []);

  const applyCrop = useCallback(async () => {
    const img = imgRef.current;
    if (!img || !imgSize || !cropRect || !onCrop) {
      return;
    }

    // Convert box coords back to image-pixel coords.
    const sx = (cropRect.x - transform.tx) / transform.scale;
    const sy = (cropRect.y - transform.ty) / transform.scale;
    const sw = cropRect.w / transform.scale;
    const sh = cropRect.h / transform.scale;

    const clampedX = Math.max(0, Math.min(imgSize.w, sx));
    const clampedY = Math.max(0, Math.min(imgSize.h, sy));
    const clampedW = Math.max(1, Math.min(imgSize.w - clampedX, sw));
    const clampedH = Math.max(1, Math.min(imgSize.h - clampedY, sh));

    const mediaType = src.startsWith("data:")
      ? (src.match(/^data:([^;]+);/)?.[1] ?? "image/png")
      : "image/png";

    const canvas = document.createElement("canvas");
    canvas.width = Math.round(clampedW);
    canvas.height = Math.round(clampedH);
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      return;
    }
    ctx.drawImage(
      img,
      clampedX,
      clampedY,
      clampedW,
      clampedH,
      0,
      0,
      canvas.width,
      canvas.height,
    );

    const dataUrl = canvas.toDataURL(mediaType);
    const data = dataUrl.split(",")[1] ?? "";

    const blob: Blob | null = await new Promise((resolve) =>
      canvas.toBlob(resolve, mediaType),
    );
    const previewUrl = blob ? URL.createObjectURL(blob) : dataUrl;

    onCrop({ data, mediaType, previewUrl });
    closeImageViewer();
  }, [imgSize, cropRect, onCrop, transform, src]);

  const onMinimapPan = useCallback(
    (newTx: number, newTy: number) => {
      resetTo({ scale: transform.scale, tx: newTx, ty: newTy });
    },
    [transform.scale, resetTo],
  );

  const canPan =
    !cropping &&
    imgSize != null &&
    (imgSize.w * transform.scale > boxSize.w ||
      imgSize.h * transform.scale > boxSize.h);

  const pct = Math.round(transform.scale * 100);
  const sliderValue = scaleToSlider(transform.scale, minScale, maxScale);

  return (
    <>
      <div className={styles.backdrop} onClick={closeImageViewer} />
      <div className={styles.dialog}>
        {onCrop && !cropping && (
          <button
            aria-label="Crop image"
            className={styles.cropToggleBtn}
            onClick={enterCropMode}
            type="button"
          >
            <Icons.CropIcon size={12} />
            Crop
          </button>
        )}
        <button
          aria-label="Close"
          className={styles.closeBtn}
          onClick={closeImageViewer}
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
          {...(cropping ? {} : handlers)}
        >
          <img
            ref={imgRef}
            alt={alt}
            className={styles.image}
            draggable={false}
            onContextMenu={(e) => {
              e.preventDefault();
              showImageContextMenu(e.currentTarget.src, alt || "image");
            }}
            onDoubleClick={cropping ? undefined : fitToScreen}
            onError={(e) => {
              if (fallbackSrc && e.currentTarget.src !== fallbackSrc) {
                e.currentTarget.src = fallbackSrc;
              }
            }}
            onLoad={onImageLoad}
            src={src}
            style={{
              transform: `translate(${transform.tx}px, ${transform.ty}px)`,
              width: imgSize ? imgSize.w * transform.scale : undefined,
              height: imgSize ? imgSize.h * transform.scale : undefined,
            }}
          />
          {cropping && cropRect && imageBoxRect && (
            <CropOverlay
              imageRect={imageBoxRect}
              rect={cropRect}
              onChange={setCropRect}
            />
          )}
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
          {cropping ? (
            <div className={styles.actionBar}>
              <button
                className={styles.actionBtn}
                onClick={cancelCrop}
                type="button"
              >
                Cancel
              </button>
              <button
                className={styles.actionBtn}
                onClick={applyCrop}
                type="button"
              >
                <Icons.CheckIcon size={12} />
                Apply crop
              </button>
            </div>
          ) : (
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
          )}
        </div>
      </div>
    </>
  );
}

const HANDLES: ResizeHandle[] = ["n", "s", "e", "w", "nw", "ne", "sw", "se"];

const HANDLE_CLASS: Record<ResizeHandle, string> = {
  n: styles.cropHandleN,
  s: styles.cropHandleS,
  e: styles.cropHandleE,
  w: styles.cropHandleW,
  nw: styles.cropHandleNW,
  ne: styles.cropHandleNE,
  sw: styles.cropHandleSW,
  se: styles.cropHandleSE,
};

function CropOverlay({
  rect,
  imageRect,
  onChange,
}: {
  imageRect: BoxRect;
  onChange: (next: BoxRect) => void;
  rect: BoxRect;
}) {
  const beginDrag = useCallback(
    (handle: ResizeHandle | "move", e: React.PointerEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const startPointer = { x: e.clientX, y: e.clientY };
      const startRect: BoxRect = { ...rect };
      const minSize = 8;
      const controller = new AbortController();

      const onMove = (ev: PointerEvent) => {
        const dx = ev.clientX - startPointer.x;
        const dy = ev.clientY - startPointer.y;
        const r = startRect;
        const bounds = imageRect;

        let next: BoxRect;
        if (handle === "move") {
          let nx = r.x + dx;
          let ny = r.y + dy;
          nx = Math.max(bounds.x, Math.min(bounds.x + bounds.w - r.w, nx));
          ny = Math.max(bounds.y, Math.min(bounds.y + bounds.h - r.h, ny));
          next = { x: nx, y: ny, w: r.w, h: r.h };
        } else {
          let x1 = r.x;
          let y1 = r.y;
          let x2 = r.x + r.w;
          let y2 = r.y + r.h;
          if (handle.includes("n")) {
            y1 = Math.min(y2 - minSize, Math.max(bounds.y, r.y + dy));
          }
          if (handle.includes("s")) {
            y2 = Math.max(
              y1 + minSize,
              Math.min(bounds.y + bounds.h, r.y + r.h + dy),
            );
          }
          if (handle.includes("w")) {
            x1 = Math.min(x2 - minSize, Math.max(bounds.x, r.x + dx));
          }
          if (handle.includes("e")) {
            x2 = Math.max(
              x1 + minSize,
              Math.min(bounds.x + bounds.w, r.x + r.w + dx),
            );
          }
          next = { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
        }

        onChange(next);
      };

      const stop = () => controller.abort();

      window.addEventListener("pointermove", onMove, {
        signal: controller.signal,
      });
      window.addEventListener("pointerup", stop, {
        signal: controller.signal,
      });
      window.addEventListener("pointercancel", stop, {
        signal: controller.signal,
      });
    },
    [rect, imageRect, onChange],
  );

  return (
    <div className={styles.cropLayer}>
      <div
        className={styles.cropSelection}
        onPointerDown={(e) => beginDrag("move", e)}
        style={{
          left: rect.x,
          top: rect.y,
          width: rect.w,
          height: rect.h,
        }}
      >
        {HANDLES.map((h) => (
          <div
            key={h}
            className={`${styles.cropHandle} ${HANDLE_CLASS[h]}`}
            onPointerDown={(e) => beginDrag(h, e)}
          />
        ))}
      </div>
    </div>
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
