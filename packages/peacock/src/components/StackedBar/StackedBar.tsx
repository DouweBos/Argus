import type { ReactNode } from "react";
import styles from "./StackedBar.module.css";

export interface StackedBarSegment {
  label: string;
  value: number;
  /** Legend and tooltip text for the value; the raw number when omitted. */
  display?: ReactNode;
  /** Secondary legend text, e.g. the share of the whole. */
  detail?: ReactNode;
}

export interface StackedBarProps {
  /** Parts of one whole, in fixed order; up to four series colours. */
  segments: StackedBarSegment[];
  caption?: string;
  className?: string;
}

const SERIES = [styles.s1, styles.s2, styles.s3, styles.s4];

/**
 * One whole split into parts: a single horizontal bar, one series colour per
 * part, with a labelled legend so identity never rests on colour alone.
 */
export function StackedBar({ segments, caption, className }: StackedBarProps) {
  const parts = segments.slice(0, SERIES.length);
  const total = parts.reduce((sum, s) => sum + Math.max(0, s.value), 0);
  const summary = parts
    .map(
      (s) =>
        `${s.label} ${typeof s.display === "string" ? s.display : s.value}`,
    )
    .join(", ");

  return (
    <figure className={[styles.figure, className].filter(Boolean).join(" ")}>
      {caption && <figcaption className={styles.caption}>{caption}</figcaption>}
      <div
        aria-label={`${caption ?? "Breakdown"}: ${summary}`}
        className={styles.track}
        role="img"
      >
        {total > 0 &&
          parts.map((s, i) =>
            s.value > 0 ? (
              <span
                className={`${styles.segment} ${SERIES[i]}`}
                key={s.label}
                style={{ flexGrow: s.value / total }}
                title={`${s.label}: ${typeof s.display === "string" ? s.display : s.value}`}
              />
            ) : null,
          )}
      </div>
      <ul className={styles.legend}>
        {parts.map((s, i) => (
          <li className={styles.item} key={s.label}>
            <span className={`${styles.swatch} ${SERIES[i]}`} />
            <span className={styles.label}>{s.label}</span>
            <span className={styles.value}>{s.display ?? s.value}</span>
            {s.detail != null && (
              <span className={styles.detail}>{s.detail}</span>
            )}
          </li>
        ))}
      </ul>
    </figure>
  );
}
