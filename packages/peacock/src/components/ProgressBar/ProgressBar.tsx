import type { HTMLAttributes } from "react";
import styles from "./ProgressBar.module.css";

export type ProgressBarSize = "md" | "sm" | "xs";

export interface ProgressBarProps extends Omit<
  HTMLAttributes<HTMLDivElement>,
  "role"
> {
  /** Accessible label — falls back to "Progress". */
  "aria-label"?: string;
  /** Show an indeterminate, sliding fill instead of a fixed value. */
  indeterminate?: boolean;
  /** Fill ratio 0–1 (clamped). Ignored when `indeterminate`. */
  progress?: number;
  size?: ProgressBarSize;
}

/**
 * Linear determinate progress bar with an accent-gradient fill. Use for
 * long-running pipelines where step counts are meaningful (e.g. session setup).
 * Pass `indeterminate` for cases where total work isn't yet known.
 */
export function ProgressBar({
  "aria-label": ariaLabel = "Progress",
  className,
  indeterminate = false,
  progress = 0,
  size = "sm",
  ...rest
}: ProgressBarProps) {
  const pct = Math.max(0, Math.min(1, progress));
  const sizeClass: Record<ProgressBarSize, string> = {
    xs: styles.sizeXs,
    sm: styles.sizeSm,
    md: styles.sizeMd,
  };

  return (
    <div
      role="progressbar"
      aria-label={ariaLabel}
      aria-valuemin={0}
      aria-valuemax={1}
      aria-valuenow={indeterminate ? undefined : pct}
      className={[styles.track, sizeClass[size], className]
        .filter(Boolean)
        .join(" ")}
      {...rest}
    >
      <div
        className={`${styles.fill} ${indeterminate ? styles.indeterminate : ""}`}
        style={indeterminate ? undefined : { width: `${pct * 100}%` }}
      />
    </div>
  );
}
