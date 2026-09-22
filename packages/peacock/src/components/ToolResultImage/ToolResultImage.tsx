import { useState, type MouseEvent } from "react";
import { Dialog } from "../Dialog/Dialog";
import { DialogBody } from "../Dialog/DialogBody";
import styles from "./ToolResultImage.module.css";

export interface ToolResultImageProps {
  src: string;
  alt?: string;
  /** Fallback src if the primary fails to load (e.g. base64 behind a protocol). */
  fallbackSrc?: string;
  className?: string;
  /**
   * Override the built-in lightbox — desktop passes a handler that opens its
   * native image window. When omitted, clicking zooms via the Peacock Dialog.
   */
  onActivate?: (src: string) => void;
  onContextMenu?: (e: MouseEvent<HTMLImageElement>) => void;
}

/**
 * A tool-result image with click-to-zoom. `src` is resolved by the consumer
 * (desktop `argus-file://`, web `agents.image` data URL); the lightbox is the
 * Peacock Dialog unless `onActivate` overrides it.
 */
export function ToolResultImage({
  src,
  alt = "tool result",
  fallbackSrc,
  className,
  onActivate,
  onContextMenu,
}: ToolResultImageProps) {
  const [zoomed, setZoomed] = useState(false);

  const img = (
    <img
      alt={alt}
      className={`${styles.image} ${className ?? ""}`}
      onClick={() => (onActivate ? onActivate(src) : setZoomed(true))}
      onContextMenu={onContextMenu}
      onError={(e) => {
        const el = e.currentTarget;
        if (fallbackSrc && el.src !== fallbackSrc) {
          el.src = fallbackSrc;
        }
      }}
      src={src}
    />
  );

  return (
    <>
      {img}
      {zoomed && (
        <Dialog
          onClose={() => setZoomed(false)}
          size="full"
          title={alt}
          titleId="tool-result-image"
          className={styles.lightbox}
        >
          <DialogBody flush>
            <img alt={alt} className={styles.zoomImage} src={src} />
          </DialogBody>
        </Dialog>
      )}
    </>
  );
}
