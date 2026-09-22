import type { HTMLAttributes } from "react";
import styles from "./ThinkingDots.module.css";

export interface ThinkingDotsProps extends HTMLAttributes<HTMLSpanElement> {
  /**
   * A longer, gentler bounce. For dots that sit in running text rather than
   * standing in for a whole message — at that size the default reads as a
   * flicker next to the words.
   */
  slow?: boolean;
}

export function ThinkingDots({ slow, className, ...rest }: ThinkingDotsProps) {
  return (
    <span
      className={[styles.dots, slow ? styles.slow : "", className]
        .filter(Boolean)
        .join(" ")}
      aria-label="Thinking"
      {...rest}
    >
      <span className={styles.dot} />
      <span className={styles.dot} />
      <span className={styles.dot} />
    </span>
  );
}
