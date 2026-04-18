import type { HTMLAttributes } from "react";
import styles from "./DiffStat.module.css";

export interface DiffStatProps extends HTMLAttributes<HTMLSpanElement> {
  added?: number;
  removed?: number;
  files?: number;
}

export function DiffStat({
  added,
  removed,
  files,
  className,
  ...rest
}: DiffStatProps) {
  return (
    <span
      className={[styles.stat, className].filter(Boolean).join(" ")}
      {...rest}
    >
      {added != null && <span className={styles.add}>+{added}</span>}
      {removed != null && <span className={styles.del}>−{removed}</span>}
      {files != null && <span className={styles.files}>{files}</span>}
    </span>
  );
}
