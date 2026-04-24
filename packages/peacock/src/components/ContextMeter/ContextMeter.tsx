import type { HTMLAttributes } from "react";
import styles from "./ContextMeter.module.css";

export type ContextMeterTone = "accent" | "danger" | "warning";

export interface ContextMeterProps extends HTMLAttributes<HTMLDivElement> {
  /** Fill ratio 0–1. Clamped. */
  progress: number;
  /** Pixel diameter of the ring. */
  size?: number;
  /** Stroke width of the ring. */
  stroke?: number;
  /**
   * Tone override. When omitted the tone is derived from progress:
   * <70% accent, <90% warning, ≥90% danger.
   */
  tone?: ContextMeterTone;
}

export function ContextMeter({
  progress,
  size = 16,
  stroke = 2,
  tone,
  className,
  ...rest
}: ContextMeterProps) {
  const pct = Math.max(0, Math.min(1, progress));
  let derivedTone: ContextMeterTone = "accent";
  if (pct >= 0.9) {
    derivedTone = "danger";
  } else if (pct >= 0.7) {
    derivedTone = "warning";
  }
  const resolvedTone: ContextMeterTone = tone ?? derivedTone;
  const toneClassMap: Record<ContextMeterTone, string> = {
    accent: styles.accent,
    danger: styles.danger,
    warning: styles.warning,
  };

  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const dashOffset = circumference * (1 - pct);

  return (
    <div
      className={[styles.root, toneClassMap[resolvedTone], className]
        .filter(Boolean)
        .join(" ")}
      {...rest}
    >
      <svg
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        className={styles.ring}
        aria-hidden="true"
      >
        <circle
          className={styles.track}
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          strokeWidth={stroke}
        />
        <circle
          className={styles.fill}
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={dashOffset}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
      </svg>
    </div>
  );
}
