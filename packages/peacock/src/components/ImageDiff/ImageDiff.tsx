/**
 * ImageDiff — visual comparison primitive for image files.
 *
 * Renders in three modes:
 *   "slider"  — overlay two images with a draggable reveal slider (default)
 *   "side"    — side-by-side panels
 *   "deleted" — single tombstone thumbnail for removed images
 *
 * All content stays inside this component; no inline SVG in app/.
 */

import {
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  useCallback,
  useId,
  useRef,
  useState,
} from "react";
import * as Icons from "../../icons/Icons";
import styles from "./ImageDiff.module.css";

export interface ImageMeta {
  /** File size in bytes (optional — displayed in caption if provided). */
  bytes?: number;
  /** Natural image dimensions (optional — displayed in caption if provided). */
  height?: number;
  width?: number;
}

export interface ImageDiffProps {
  /**
   * Data URL ("data:image/...;base64,...") or HTTP/HTTPS URL for the "after"
   * image (current version). Undefined means the file is deleted.
   */
  after?: string;
  afterMeta?: ImageMeta;
  /**
   * Data URL for the "before" image (HEAD version). Undefined means the file
   * is newly added.
   */
  before?: string;
  beforeMeta?: ImageMeta;
}

type ViewMode = "side" | "slider";

function formatBytes(n: number): string {
  if (n < 1024) {
    return `${n} B`;
  }
  if (n < 1024 * 1024) {
    return `${(n / 1024).toFixed(1)} KB`;
  }

  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function MetaCaption({
  label,
  meta,
  side,
}: {
  label: string;
  meta?: ImageMeta;
  side: "added" | "deleted" | "modified";
}): ReactNode {
  if (!meta) {
    return null;
  }

  return (
    <span className={styles.captionPair}>
      <span className={`${styles.captionKey} ${styles[side]}`}>{label}</span>
      {meta.width !== undefined && meta.height !== undefined && (
        <span className={styles.captionValue}>
          {meta.width}&times;{meta.height}
        </span>
      )}
      {meta.bytes !== undefined && (
        <span className={styles.captionValue}>{formatBytes(meta.bytes)}</span>
      )}
    </span>
  );
}

/** Slider overlay — draggable vertical split between before/after images. */
function SliderView({
  before,
  after,
}: {
  after: string;
  before: string;
}): ReactNode {
  const rootRef = useRef<HTMLDivElement>(null);
  const [splitPct, setSplitPct] = useState(50);
  const dragging = useRef(false);

  const updateSplit = useCallback((clientX: number) => {
    const el = rootRef.current;
    if (!el) {
      return;
    }
    const rect = el.getBoundingClientRect();
    const pct = Math.min(
      100,
      Math.max(0, ((clientX - rect.left) / rect.width) * 100),
    );
    setSplitPct(pct);
  }, []);

  const onPointerDown = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      dragging.current = true;
      (e.currentTarget as HTMLDivElement).setPointerCapture(e.pointerId);
      updateSplit(e.clientX);
    },
    [updateSplit],
  );

  const onPointerMove = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      if (!dragging.current) {
        return;
      }
      updateSplit(e.clientX);
    },
    [updateSplit],
  );

  const onPointerUp = useCallback(() => {
    dragging.current = false;
  }, []);

  return (
    <div ref={rootRef} className={styles.sliderRoot}>
      {/* Base (before) image — always full width */}
      <img alt="Before" className={styles.sliderBaseImg} src={before} />

      {/* Overlay (after) image — clipped to left portion */}
      <img
        alt="After"
        className={styles.sliderOverlayImg}
        src={after}
        style={{ clipPath: `inset(0 ${100 - splitPct}% 0 0)` }}
      />

      {/* Drag track */}
      <div
        className={styles.sliderTrack}
        style={{ left: `${splitPct}%` }}
        aria-hidden="true"
      >
        <div className={styles.sliderKnob}>
          <Icons.ImageDiffSliderIcon size={14} />
        </div>
      </div>

      {/* Full-area hit zone */}
      <div
        className={styles.sliderHitArea}
        role="slider"
        aria-label="Image comparison slider"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(splitPct)}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      />
    </div>
  );
}

function SideBySideView({
  before,
  after,
  beforeMeta,
  afterMeta,
}: {
  after: string | undefined;
  afterMeta?: ImageMeta;
  before: string | undefined;
  beforeMeta?: ImageMeta;
}): ReactNode {
  const isAdded = !before && !!after;
  const isDeleted = !!before && !after;

  return (
    <div className={styles.sideBySide}>
      {/* Before panel */}
      <div className={styles.panel}>
        <span
          className={`${styles.panelLabel}${isDeleted ? " " + styles.deleted : ""}`}
        >
          {isAdded ? "Not present" : "Before"}
        </span>
        <div className={styles.imageWrap}>
          {before ? (
            <img alt="Before" className={styles.image} src={before} />
          ) : (
            <div className={styles.tombstone}>
              <Icons.FileIcon size={40} className={styles.tombstoneIcon} />
              <span className={styles.tombstoneLabel}>Added</span>
            </div>
          )}
        </div>
        {beforeMeta && (
          <div className={styles.caption}>
            <MetaCaption
              label="before"
              meta={beforeMeta}
              side={isDeleted ? "deleted" : "modified"}
            />
          </div>
        )}
      </div>

      {/* After panel */}
      <div className={styles.panel}>
        <span
          className={`${styles.panelLabel}${isAdded ? " " + styles.added : ""}`}
        >
          {isDeleted ? "Deleted" : "After"}
        </span>
        <div className={styles.imageWrap}>
          {after ? (
            <img alt="After" className={styles.image} src={after} />
          ) : (
            <div className={styles.tombstone}>
              <Icons.FileIcon size={40} className={styles.tombstoneIcon} />
              <span className={styles.tombstoneLabel}>Deleted</span>
            </div>
          )}
        </div>
        {afterMeta && (
          <div className={styles.caption}>
            <MetaCaption
              label="after"
              meta={afterMeta}
              side={isAdded ? "added" : "modified"}
            />
          </div>
        )}
      </div>
    </div>
  );
}

export function ImageDiff({
  before,
  after,
  beforeMeta,
  afterMeta,
}: ImageDiffProps): ReactNode {
  const modeSwitcherId = useId();
  const hasSlider = !!before && !!after;
  const [viewMode, setViewMode] = useState<ViewMode>(
    hasSlider ? "slider" : "side",
  );

  const isAdded = !before && !!after;
  const isDeleted = !!before && !after;

  return (
    <div className={styles.root}>
      {/* Mode toggle — only show when both images exist */}
      {hasSlider && (
        <div className={styles.modeStrip} role="group" id={modeSwitcherId}>
          <button
            type="button"
            className={`${styles.modeBtn}${viewMode === "slider" ? " " + styles.modeBtnActive : ""}`}
            onClick={() => setViewMode("slider")}
            aria-pressed={viewMode === "slider"}
          >
            Slider
          </button>
          <button
            type="button"
            className={`${styles.modeBtn}${viewMode === "side" ? " " + styles.modeBtnActive : ""}`}
            onClick={() => setViewMode("side")}
            aria-pressed={viewMode === "side"}
          >
            Side by side
          </button>
        </div>
      )}

      {/* Slider mode */}
      {hasSlider && viewMode === "slider" && (
        <SliderView before={before} after={after} />
      )}

      {/* Side-by-side or single-panel (added / deleted) */}
      {(viewMode === "side" || !hasSlider) && (
        <SideBySideView
          before={before}
          after={after}
          beforeMeta={beforeMeta}
          afterMeta={afterMeta}
        />
      )}

      {/* Tombstone-only for deleted with no side-by-side needed (already shown via SideBySideView) */}

      {/* Combined caption for slider mode */}
      {hasSlider && viewMode === "slider" && (beforeMeta ?? afterMeta) && (
        <div className={styles.caption}>
          {beforeMeta && (
            <MetaCaption label="before" meta={beforeMeta} side="modified" />
          )}
          {afterMeta && (
            <MetaCaption label="after" meta={afterMeta} side="modified" />
          )}
        </div>
      )}

      {/* Single-image caption for added/deleted */}
      {isAdded && afterMeta && (
        <div className={styles.caption}>
          <MetaCaption label="added" meta={afterMeta} side="added" />
        </div>
      )}
      {isDeleted && beforeMeta && (
        <div className={styles.caption}>
          <MetaCaption label="deleted" meta={beforeMeta} side="deleted" />
        </div>
      )}
    </div>
  );
}
