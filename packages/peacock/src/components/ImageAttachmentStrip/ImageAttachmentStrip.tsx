import { CloseIcon } from "../../icons/Icons";
import styles from "./ImageAttachmentStrip.module.css";

export interface ImageAttachmentStripItem {
  name: string;
  previewUrl: string;
}

export interface ImageAttachmentStripProps {
  items: ImageAttachmentStripItem[];
  onRemove: (index: number) => void;
  onPreview?: (index: number) => void;
  /** When true, the strip scrolls horizontally instead of wrapping. */
  scroll?: boolean;
  className?: string;
}

export function ImageAttachmentStrip({
  items,
  onRemove,
  onPreview,
  scroll,
  className,
}: ImageAttachmentStripProps) {
  if (items.length === 0) {
    return null;
  }

  const classes = [
    styles.strip,
    scroll ? styles.stripScroll : "",
    className ?? "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div className={classes}>
      {items.map((item, i) => (
        <div key={item.name + i} className={styles.thumb}>
          <button
            className={styles.previewBtn}
            title={item.name}
            type="button"
            onClick={() => onPreview?.(i)}
          >
            <img alt={item.name} className={styles.img} src={item.previewUrl} />
          </button>
          <button
            aria-label={`Remove ${item.name}`}
            className={styles.remove}
            title="Remove"
            type="button"
            onClick={() => onRemove(i)}
          >
            <CloseIcon size={8} />
          </button>
        </div>
      ))}
    </div>
  );
}
