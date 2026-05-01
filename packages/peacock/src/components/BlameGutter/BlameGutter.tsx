import { useMemo } from "react";
import styles from "./BlameGutter.module.css";

export interface BlameChunk {
  author: string;
  authorEmail?: string;
  authorTime: number;
  commitHash: string;
  content?: string[];
  lineCount: number;
  lineStart: number;
  summary: string;
}

export interface BlameGutterProps {
  chunks: BlameChunk[];
  /** Approximate line height in px — defaults to 18 (matches typical diff). */
  lineHeight?: number;
  onChunkClick?: (commitHash: string) => void;
  selectedHash?: string;
}

const DAY_MS = 86_400_000;

function relativeTime(ts: number): string {
  if (!ts) {
    return "";
  }
  const delta = Date.now() - ts;
  if (delta < 60_000) {
    return "just now";
  }
  if (delta < 3_600_000) {
    return `${Math.floor(delta / 60_000)}m ago`;
  }
  if (delta < DAY_MS) {
    return `${Math.floor(delta / 3_600_000)}h ago`;
  }
  if (delta < 30 * DAY_MS) {
    return `${Math.floor(delta / DAY_MS)}d ago`;
  }
  if (delta < 365 * DAY_MS) {
    return `${Math.floor(delta / (30 * DAY_MS))}mo ago`;
  }

  return `${Math.floor(delta / (365 * DAY_MS))}y ago`;
}

export function BlameGutter({
  chunks,
  lineHeight = 18,
  selectedHash,
  onChunkClick,
}: BlameGutterProps) {
  // Sort by lineStart so visual order matches the file.
  const sorted = useMemo(
    () => [...chunks].sort((a, b) => a.lineStart - b.lineStart),
    [chunks],
  );

  return (
    <div className={styles.gutter} role="list">
      {sorted.map((chunk, i) => {
        const isSelected = selectedHash === chunk.commitHash;
        const classes = [
          styles.chunk,
          isSelected ? styles.selected : "",
          onChunkClick ? styles.clickable : "",
        ]
          .filter(Boolean)
          .join(" ");
        const height = chunk.lineCount * lineHeight;

        return (
          <button
            key={`${chunk.commitHash}-${chunk.lineStart}-${i}`}
            type="button"
            className={classes}
            style={{ minHeight: height }}
            title={`${chunk.commitHash.slice(0, 7)} — ${chunk.summary}`}
            onClick={() => onChunkClick?.(chunk.commitHash)}
            role="listitem"
          >
            <span className={styles.hash}>{chunk.commitHash.slice(0, 7)}</span>
            <span className={styles.author}>{chunk.author}</span>
            <span className={styles.time}>
              · {relativeTime(chunk.authorTime)}
            </span>
          </button>
        );
      })}
    </div>
  );
}
