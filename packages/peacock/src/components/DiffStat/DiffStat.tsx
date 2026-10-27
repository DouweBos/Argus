import type { HTMLAttributes } from "react";
import styles from "./DiffStat.module.css";

export interface DiffStatProps extends HTMLAttributes<HTMLSpanElement> {
  added?: number;
  removed?: number;
  files?: number;
}

/** Whether a "+N −N" pair says anything: a bare "+0 −0" is hidden. */
export function hasDiffChanges(added?: number, removed?: number): boolean {
  return (added ?? 0) !== 0 || (removed ?? 0) !== 0;
}

export function DiffStat({
  added,
  removed,
  files,
  className,
  ...rest
}: DiffStatProps) {
  const lines = hasDiffChanges(added, removed);
  if (!lines && files == null) {
    return null;
  }

  return (
    <span
      className={[styles.stat, className].filter(Boolean).join(" ")}
      {...rest}
    >
      {lines && added != null && <span className={styles.add}>+{added}</span>}
      {lines && removed != null && (
        <span className={styles.del}>−{removed}</span>
      )}
      {files != null && <span className={styles.files}>{files}</span>}
    </span>
  );
}
