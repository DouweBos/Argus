import { Spinner } from "../Spinner/Spinner";
import styles from "./InlineVideo.module.css";

export interface InlineVideoProps {
  /** Shown while loading, on failure, and as the player's accessible name. */
  label: string;
  /** Null while the file is still being fetched. */
  src: string | null;
  error?: string | null;
}

/** A video in the flow of text: a player once it's ready, its name while it loads. */
export function InlineVideo({ error, label, src }: InlineVideoProps) {
  if (error) {
    return (
      <span className={styles.placeholder}>
        {label} — {error}
      </span>
    );
  }
  if (!src) {
    return (
      <span className={styles.placeholder}>
        <Spinner size="xs" tone="muted" />
        {label}
      </span>
    );
  }

  return (
    <video
      aria-label={label}
      className={styles.video}
      controls
      preload="metadata"
      src={src}
    >
      {/* Ticket videos are screen recordings with no captions to offer. */}
      <track kind="captions" />
    </video>
  );
}
