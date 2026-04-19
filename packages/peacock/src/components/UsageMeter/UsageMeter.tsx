import type { HTMLAttributes, ReactNode } from "react";
import styles from "./UsageMeter.module.css";

export type UsageTone = "accent" | "danger" | "warning";

export interface UsageMeterProps extends HTMLAttributes<HTMLDivElement> {
  label: ReactNode;
  value: ReactNode;
  /** Progress 0–1. Omit to render the meter as text-only (no bar). */
  progress?: number;
  tone?: UsageTone;
  /** Optional trailing text (e.g. "resets in 2h 13m"). */
  hint?: ReactNode;
}

export function UsageMeter({
  label,
  value,
  progress,
  tone = "accent",
  hint,
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

  return (
    <div
      className={[styles.meter, toneClass, className].filter(Boolean).join(" ")}
      {...rest}
    >
      <div className={styles.row}>
        <span className={styles.label}>{label}</span>
        <span className={styles.value}>{value}</span>
      </div>
      {pct != null && (
        <div className={styles.track}>
          <div className={styles.fill} style={{ width: `${pct}%` }} />
        </div>
      )}
      {hint != null && <div className={styles.hint}>{hint}</div>}
    </div>
  );
}
