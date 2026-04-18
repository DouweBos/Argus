import type { HTMLAttributes } from "react";
import styles from "./ThinkingDots.module.css";

export function ThinkingDots({
  className,
  ...rest
}: HTMLAttributes<HTMLSpanElement>) {
  return (
    <span
      className={[styles.dots, className].filter(Boolean).join(" ")}
      aria-label="Thinking"
      {...rest}
    >
      <span className={styles.dot} />
      <span className={styles.dot} />
      <span className={styles.dot} />
    </span>
  );
}
