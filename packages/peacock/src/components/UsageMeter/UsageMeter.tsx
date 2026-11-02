import type { HTMLAttributes, ReactNode } from "react";
import styles from "./UsageMeter.module.css";

export type UsageTone = "accent" | "danger" | "warning";

/**
 * `sm` fits a status strip; `lg` is a card on a full screen; `row` is the
 * Mac Home's line: "Session · resets in 4h", the value, a bar beneath.
 */
export type UsageMeterSize = "lg" | "row" | "sm";

export interface UsageMeterProps extends HTMLAttributes<HTMLDivElement> {
  label: ReactNode;
  value: ReactNode;
  /** Progress 0–1. Omit to render the meter as text-only (no bar). */
  progress?: number;
  tone?: UsageTone;
  /** Optional trailing text (e.g. "resets in 2h 13m"). */
  hint?: ReactNode;
  /** Right-aligned beside the hint (e.g. "On pace"). */
  aside?: ReactNode;
  size?: UsageMeterSize;
}

export function UsageMeter({
  label,
  value,
  progress,
  tone = "accent",
  hint,
  aside,
  size = "sm",
  className,
  ...rest
}: UsageMeterProps) {
  const pct =
    progress == null ? null : Math.max(0, Math.min(1, progress)) * 100;
  const toneClassMap: Record<UsageTone, string> = {
    accent: styles.accent,
    danger: styles.danger,
    warning: styles.warning,
  };
  const toneClass = toneClassMap[tone];
  const sizeClasses: Record<UsageMeterSize, string> = {
    lg: styles.lg,
    row: styles.rowSize,
    sm: "",
  };
  const sizeClass = sizeClasses[size];
  const inlineHint = size === "row";

  return (
    <div
      className={[styles.meter, toneClass, sizeClass, className]
        .filter(Boolean)
        .join(" ")}
      {...rest}
    >
      <div className={styles.row}>
        <span className={styles.label}>
          {label}
          {inlineHint && hint != null && (
            <span className={styles.inlineHint}> · {hint}</span>
          )}
        </span>
        <span className={styles.value}>{value}</span>
      </div>
      {pct != null && (
        <div
          className={styles.track}
          role="meter"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(pct)}
        >
          <div className={styles.fill} style={{ width: `${pct}%` }} />
        </div>
      )}
      {!inlineHint && (hint != null || aside != null) && (
        <div className={styles.footer}>
          <span className={styles.hint}>{hint}</span>
          {aside != null && <span className={styles.aside}>{aside}</span>}
        </div>
      )}
    </div>
  );
}
